var fs = require('graceful-fs');
var path = require('path');
var deepExtend = require('deep-extend');
var isAsset = require('./util/isAsset');
var isComponent = require('./util/isComponent');
var createError = require('./util/createError');

var possibleJsons = ['bower.json', 'component.json', '.bower.json'];

function read(file, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }

    // Check if file is a directory
    fs.stat(file, function (err, stat) {
        if (err) {
            return callback(err);
        }

        // It's a directory, so we find the json inside it
        if (stat.isDirectory()) {
            return find(file, function (err, file) {
                if (err) {
                    return callback(err);
                }

                read(file, options, callback);
            });
        }

        // Otherwise read it
        fs.readFile(file, function (err, contents) {
            var json;

            if (err) {
                return callback(err);
            }

            try {
                json = JSON.parse(contents.toString());
            } catch (err) {
                err.file = path.resolve(file);
                err.code = 'EMALFORMED';
                return callback(err);
            }

            // Parse it
            try {
                json = parse(json, options);
            } catch (err) {
                err.file = path.resolve(file);
                return callback(err);
            }

            callback(null, json, file);
        });
    });
}

function parse(json, originalOptions) {
    var options = deepExtend({
        normalize: false,
        validate: true,
        clone: false
    }, originalOptions || {});

    // Clone
    if (options.clone) {
        json = deepExtend({}, json);
    }

    // Validate
    if (options.validate) {
        validate(json, originalOptions);
    }

    // Normalize
    if (options.normalize) {
        normalize(json);
    }

    return json;
}

function throwOnError(errors) {
    if(errors && errors.length) {
        // throw first error found for compatibility with existing validate() interface
        throw errors[0];
    }
}

function findErrors(json, options) {
    
    var errors = [];

    options = deepExtend({
        enforceNameExists: true,
        strictNames: true
    }, options || {});

    if(options.enforceNameExists && !(json.name && json.name.length)) {
        errors.push(createError('The name must not be empty', 'EINVALID'));
    }

    if(json.name) {
        errors = errors.concat(findPackageNameErrors(json.name, options.strictNames));
    }

    if (json.description && json.description.length > 140) {
        errors.push(createError('The description is too long. 140 characters should be more than enough', 'EINVALID'));
    }

    if (json.main !== undefined) {
        var main = json.main;
        if (typeof main === 'string') {
            main = [main];
        }
        if (!(main instanceof Array)) {
            errors.push(createError('The "main" field has to be either an Array or a String', 'EINVALID'));
        }
        var ext2files = {};
        main.forEach(function (filename) {
            if (typeof filename !== 'string') {
                errors.push(createError('The "main" Array has to contain only Strings', 'EINVALID'));
            }
            if (/[*]/.test(filename)) {
                errors.push(createError('The "main" field cannot contain globs (example: "*.js")', 'EINVALID'));
            }
            if (/[.]min[.][^/]+$/.test(filename)) {
                errors.push(createError('The "main" field cannot contain minified files', 'EINVALID'));
            }
            if (isAsset(filename)) {
                errors.push(createError('The "main" field cannot contain font, image, audio, or video files', 'EINVALID'));
            }
            var ext = path.extname(filename);
            if (ext.length >= 2) {
                var files = ext2files[ext];
                if (!files) {
                    files = ext2files[ext] = [];
                }
                files.push(filename);
            }
        });
        Object.keys(ext2files).forEach(function (ext) {
            var files = ext2files[ext];
            if (files.length > 1) {
                errors.push(createError('The "main" field has to contain only 1 file per filetype; found multiple ' + ext + ' files: ' + JSON.stringify(files), 'EINVALID'));
            }
        });
    }

    
    errors.concat(findDependencyErrors(json.dependencies, options.strictNames));
    errors.concat(findDependencyErrors(json.devDependencies, options.strictNames));

    // TODO https://github.com/bower/bower.json-spec

    return errors;

}

function findDependencyErrors(dependencies, strictNames) {
    var errors = [];
    if(dependencies instanceof Object) {
        Object.keys(dependencies).forEach(function(name) {
            var resource = dependencies[name];

            errors = errors.concat(findPackageNameErrors(name, strictNames));

            if(/\.\./.test(resource)) {
                errors.push(createError('Directory traversing in dependency paths is not allowed', 'EINVALID'));
            }

        });
    }
    return errors;
}

function findPackageNameErrors(name, strictNames) {

    var errors = [];

    if (!name) {
        
        throw createError('No name property set', 'EINVALID');

    } else if(typeof(name) !== 'string') {

        throw createError('Package name is not a string', 'EINVALID');

    } else {

        if (name.length >= 50) {
            throw createError('The name is too long. 50 characters should be more than enough', 'EINVALID');
        }

        if (!/[^A-z0-9\.\-]*/.test(name)) {
            throw createError('The name contains an invalid character', 'EINVALID');
        }

        if (!/^[A-z]?([A-z](([A-z0-9]\-?)*([A-z0-9]\.?)*)*[A-z0-9])?$/.test(name)) {
            throw createError('The name is malformed: ' + name, 'EINVALID');
        }

        if(strictNames) {

            if (/[A-Z]/.test(name)) {
                throw createError('The name contains upper case letters', 'EINVALID');
            }

            if (!/^[a-z]/.test(name)) {
                throw createError('The name has to start with a lower case character from a to z', 'EINVALID');
            }

            if (!/[a-z]$/.test(name)) {
                throw createError('The name has to end with a lower case character from a to z', 'EINVALID');
            }

            if (!/[a-z]/.test(name)) {
                throw createError('The name has to end with a lower case character from a to z', 'EINVALID');
            }

        }
    }

    return errors;

}

function validate(json, options) {
    throwOnError(findErrors(json, options));
    return json;
}

function validateDependencies(dependencies, strictNames) {
    throwOnError(findDependencyErrors(dependencies, strictNames));
}

function validatePackageName(name, strictNames) {
    throwOnError(findPackageNameErrors(name, strictNames));
    return true;
}

function normalize(json) {
    if (typeof json.main === 'string') {
        json.main = [json.main];
    }

    // TODO

    return json;
}

function find(folder, files, callback) {
    var err;
    var file;

    if (typeof files === 'function') {
        callback = files;
        files = possibleJsons;
    }

    if (!files.length) {
        err = createError('None of ' + possibleJsons.join(', ') + ' were found in ' + folder, 'ENOENT');
        return callback(err);
    }

    file = path.resolve(path.join(folder, files[0]));
    fs.exists(file, function (exists) {
        if (!exists) {
            return find(folder, files.slice(1), callback);
        }

        if (files[0] !== 'component.json') {
            return callback(null, file);
        }

        // If the file is component.json, check it it's a component(1) file
        // If it is, we ignore it and keep searching
        isComponent(file, function (is) {
            if (is) {
                return find(folder, files.slice(1), callback);
            }

            callback(null, file);
        });
    });
}

module.exports = read;
module.exports.read = read;
module.exports.parse = parse;
module.exports.validate = validate;
module.exports.findErrors = findErrors;
module.exports.normalize = normalize;
module.exports.find = find;
