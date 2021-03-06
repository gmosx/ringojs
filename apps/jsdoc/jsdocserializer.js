/**
 * @fileoverview This module creates jsonable objects from the documentation
 * extracted by `ringo/jsdoc`.
 *
 * `moduleDoc()` returns an object with an unsorted list of all jsdoc'ed properties
 * found in a module. `structureModuleDoc()` can turn this object into something more
 * structured: it collects all classes, attaches them their properties and also
 * puts all the module properties into extra lists.
 *
 * @see ringo/jsdoc
 */

// stdlib
var strings = require('ringo/utils/strings');
var {parseResource} = require('ringo/jsdoc');
var {ScriptRepository} = require('ringo/jsdoc');
var {join, base, directory, canonical} = require('fs');

/**
 * @params {ScriptRepository|String} repositoryOrPath
 * @returns {String} string representation for a repository
 */
var getRepositoryName = exports.getRepositoryName = function(repositoryOrPath) {
    // use last two path elements as anchor text
    // e.g. "ringojs/modules", "jetson/lib" and replace / with _
    var path = typeof repositoryOrPath == 'string' ? canonical(repositoryOrPath) : repositoryOrPath.getPath();
    return join(base(directory(path)), base(canonical(path))).split('/').join('_');
};

/**
 * Returns a name sorted, stringify-able list of objects describing the
 * modules for the given repositoryPath.
 *
 * @param {String} repositoryPath
 * @param {Boolean} moduleFileOverview if true every module will be parsed and
 *                  it's fileoverview attached. default: false.
 * @returns {Array} modules
 */
var moduleList = exports.moduleList = function(repositoryPath, moduleFileOverview) {
    var repository = new ScriptRepository(repositoryPath);
    var modules = repository.getScriptResources(true).filter(function(r) {
        return !r.moduleName.match(/^ringo\/?global$/);
    }).map(function(mod) {
        var fileoverview = undefined;
        if (moduleFileOverview == true) {
            var docItems = parseResource(mod);
            fileoverview = docItems.fileoverview && docItems.fileoverview.getTag('fileoverview') || '';
        }
        return {
            id: mod.moduleName.replace(/\./g,'/'),
            fileoverview: fileoverview,
        }
    }).sort(function(a, b) {
        return a.id > b.id ? 1 : -1;
    });

   return modules;
};

/**
 * @params {Array} repositoryPaths paths to repositories
 * @returns {Array} objects describing repositories passed
 */
var repositoryList = exports.repositoryList = function(repositoryPaths) {
    var repositories = {};
    repositoryPaths.forEach(function(path, idx) {
        repositories[getRepositoryName(path)] = path;
    });
    return repositories;
};

/**
 * @returns {Array} objects with jsdoc information for each property defined in module
 */
var moduleDoc = exports.moduleDoc = function(repositoryPath, moduleId) {
    var repository = new ScriptRepository(repositoryPath);
    var res = repository.getScriptResource(moduleId + '.js');
    if (!res.exists()) {
        return null;
    }
    var docItems = parseResource(res);

    var doc = {};
    doc.name = moduleId;
    if (docItems.fileoverview) {
        doc.fileoverview = docItems.fileoverview.getTag('fileoverview');
        doc.example = docItems.fileoverview.getTag('example');
        doc.since = docItems.fileoverview.getTag('since');
        doc.deprecated = docItems.fileoverview.getTag('deprecated');
    }
    // tags for all items in this module
    var items = [];
    doc.items = docItems.map(function(docItem, i) {
        var [returns, type] = getReturns(docItem);
        var next = docItems[i+1];
        // unify instance & prototype
        var name = docItem.name;
        var nameParts = docItem.name.split('.');
        // normalize instance/prototype -> prototype
        if (nameParts.length > 2) {
            if (nameParts[1] === 'instance') {
                nameParts[1] = 'prototype';
            }
            name = nameParts.join('.');
        }
        var shortName = docItem.name.split('.').splice(-1)[0];
        return {
            name: name,
            shortName: shortName,
            relatedClass: getRelatedClass(docItem),
            desc: docItem.getTag('desc') || '',
            isClass: isClass(docItem, next),
            isFunction: docItem.isFunction,
            isStatic: isStatic(docItem, next),
            parameters: getParameters(docItem),
            throws: getThrows(docItem),
            sees: getSees(docItem),
            returns: {
                name: returns,
                type: type
            },
            // standard
            example:  docItem.getTag('example'),
            since: docItem.getTag('since'),
            deprecated: docItem.getTag('deprecated'),
        };
    });
    return doc;
};

/**
 * Transforms the JsDoc Data as generated moduleDoc into this structure and leaves
 * all other properties (`items`, `fileoverview`,..) attached.
 *
 *  {
 *      danglingFunctions: [],
 *      danglingProperties: [],
 *      classes: [{
 *          methods: [],
 *          properties: [],
 *          staticMethods: [],
 *          staticProperties: [],
 *      },...]
 *
 *  }
 *
 * @see #moduleDoc
 * @param {Object} data
 * @returns {Object}
 *
 */
exports.structureModuleDoc = function(data) {

    var classes = data.items.filter(function(item) {
        return item.isClass;
    });

    var filterByName = function(className) {
        return (function(item) {
            return item.name === className;
        });
    };

    var functions = data.items.filter(function(item) {
        return item.isFunction && !item.IsClass;
    });

    var properties = data.items.filter(function(item) {
        return !item.isFunction && !item.isClass;
    });

    // if we find a function for a class which isn't yet in classes
    // add it.
    functions.forEach(function(item) {
        if (item.relatedClass) {
            var classForName = classes.filter(filterByName(item.relatedClass));
            if (!classForName || !classForName.length) {
                classes.push({
                    isClass: true,
                    name: item.relatedClass,
                });
            }
        }
    });

    // now that we have all classes sort 'em
    classes.sort(function(a,b) {
        return a.name < b.name ? -1 : 1;
    });

    data.danglingFunctions = functions.filter(function(item) {
        return !item.relatedClass && !item.isClass;
    });

    data.danglingProperties = properties.filter(function(item) {
        return !item.relatedClass;
    });

    classes.forEach(function(class, i) {
        function isStatic(item) {
            return item.relatedClass === class.name && item.isStatic;
        };
        function isNotStatic(item) {
            return item.relatedClass === class.name && !item.isStatic;
        }

        class.methods = functions.filter(isNotStatic);;
        class.properties = properties.filter(isNotStatic);

        class.staticProperties = properties.filter(isStatic);
        class.staticMethods = functions.filter(isStatic);
    });
    data.classes = classes;
    return data;
};

/**
 * @returns true if the item is static
 */
function isStatic(item, next) {
    return !isClass(isClass, next) && ['instance', 'prototype'].indexOf(item.name.split('.')[1]) < 0
};

/**
 * @returns {Boolean} true if them is a class (constructor).
 */
function isClass(item, next) {
    var name = item.name;
    return item.isClass ||
                (isClassName(name) && isClassMember(name, next && next.name));
};

/**
 * @returns {Array} errors the item might throw
 */
function getThrows(item) {
    return item.getTags('throws').map(function(error) {
        return error;
    });
};

function getParameters(item) {
    return item.getParameterList().map(function(param) {
        return {
            name: param.name,
            type: param.type,
            desc: param.desc,
        };
    });
};

function getRelatedClass(item) {
    // FIXME there's a jsdoc tag for that too, right?
    var relatedClass = null;
    var nameParts = item.name.split('.');
    return nameParts.filter(function(namePart, idx, array) {
        if (array.length-1 == idx || namePart == 'prototype' || namePart == 'instance') {
            return false;
        } else {
            return true;
        };
    }).join('.');
}

function getSees(item) {
    return item.getTags('see').map(function(link) {
        if (strings.isUrl(link)) {
            link = '<a href="' + link + '">' + link + '</a>';
        } else {
            // apply some sanity checks to local targets like removing hashes and parantheses
            link = link.replace(/^#/, '');
            var id = link.replace(/[\(\)]/g, '');
            link = '<a href="#' + id + '">' + link + '</a>';
        }
        return link;
    });
};

function getReturns(item) {
    var returns = item.getTag('returns') || item.getTag('return');
    var type = item.getTag('type');
    if (returns) {
        if (!type) {
            type = returns.match(/^{(\S+)}/) || "";
            if (type) {
                returns = returns.substring(type[0].length);
                type = type[1];
            }
        }
    }
    return [returns, type];
};

function isClassName(name) {
    return name && name[0] == name[0].toUpperCase();
};

function isClassMember(name, childName) {
    // check if child name is a property of name
    return childName && strings.startsWith(childName, name + ".");
};
