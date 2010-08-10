package org.ringojs.jsgi;

//import org.eclipse.jetty.continuation.ContinuationSupport;
import org.mozilla.javascript.Context;
import org.ringojs.tools.RingoConfiguration;
import org.ringojs.tools.RingoRunner;
import org.ringojs.repository.Repository;
import org.ringojs.repository.FileRepository;
import org.ringojs.repository.WebappRepository;
import org.ringojs.engine.RhinoEngine;
import org.ringojs.util.StringUtils;
import org.mozilla.javascript.Callable;

import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.ServletConfig;
import javax.servlet.ServletException;
import java.io.IOException;
import java.io.File;

/**
 * A custom version of the JsgiServlet for use with Google App Engine.
 */
public class AppengineServlet extends JsgiServlet {

    String module;
    Object function;
    RhinoEngine engine;
    JsgiRequest requestProto;
    //boolean hasContinuation = false;
    String environment;
    
    public AppengineServlet() {
        this.environment = System.getProperty("com.google.appengine.runtime.environment");
    }

    public AppengineServlet(RhinoEngine engine) throws ServletException {
        this(engine, null);
    }

    public AppengineServlet(RhinoEngine engine, Callable callable) throws ServletException {
        this.engine = engine;
        this.function = callable;
        this.environment = System.getProperty("com.google.appengine.runtime.environment");
    }

    @Override
    public void init(ServletConfig config) throws ServletException {
        super.init(config);
 
        // Are we running on the GAE production environment?
        boolean isProd = (this.environment == "Production");
       
        // don't overwrite function if it was set in constructor
        if (function == null) {
            module = getStringParameter(config, "config", "main");
            function = getStringParameter(config, "app", isProd ? "production" : "development");
        }

        if (engine == null) {
            String ringoHome = getStringParameter(config, "ringo-home", "/WEB-INF");
            String modulePath = getStringParameter(config, "module-path", "app");
            int optlevel = getIntParameter(config, "optlevel", isProd ? 9 : 0);
            boolean debug = false; // getBooleanParameter(config, "debug", false);
            boolean production = getBooleanParameter(config, "production", isProd ? true : false);
            boolean verbose = getBooleanParameter(config, "verbose", false);
            boolean legacyMode = getBooleanParameter(config, "legacy-mode", false);

            Repository home = new WebappRepository(config.getServletContext(), ringoHome);
            try {
                if (!home.exists()) {
                    home = new FileRepository(ringoHome);
                    System.err.println("Resource \"" + ringoHome + "\" not found, "
                            + "reverting to file repository " + home);
                }
                // Use ',' as platform agnostic path separator
                String[] paths = StringUtils.split(modulePath, ",");
                RingoConfiguration ringoConfig = new RingoConfiguration(home, paths, "modules");
                ringoConfig.setDebug(debug);
                ringoConfig.setVerbose(verbose);
                ringoConfig.setParentProtoProperties(legacyMode);
                ringoConfig.setStrictVars(!legacyMode && !production);
                ringoConfig.setReloading(!production);
                ringoConfig.setOptLevel(optlevel);
                engine = new RhinoEngine(ringoConfig, null);
            } catch (Exception x) {
                throw new ServletException(x);
            }
        }

        Context cx = engine.getContextFactory().enterContext();
        try {
            requestProto = new JsgiRequest(cx, engine.getScope());
        } catch (NoSuchMethodException nsm) {
            throw new ServletException(nsm);
        } finally {
            Context.exit();
        }
/*
        try {
            hasContinuation = ContinuationSupport.class != null;
        } catch (NoClassDefFoundError ignore) {
            hasContinuation = false;
        }
*/        
    }

    @Override
    protected void service(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {
/*
        try {
            if (hasContinuation && ContinuationSupport.getContinuation(request).isExpired()) {
                return; // continuation timeouts are handled by ringo/jsgi module
            }
        } catch (Exception ignore) {
            // continuation may not be set up even if class is availble - ignore
        }
*/        
        Context cx = engine.getContextFactory().enterContext();
        try {
            JsgiRequest req = new JsgiRequest(cx, request, response, requestProto, engine.getScope());
            engine.invoke("ringo/jsgi", "handleRequest", module, function, req);
        } catch (NoSuchMethodException x) {
            RingoRunner.reportError(x, System.err, false);
            throw new ServletException(x);
        } catch (Exception x) {
            RingoRunner.reportError(x, System.err, false);
            throw new ServletException(x);
        } finally {
            Context.exit();
        }
    }
}
