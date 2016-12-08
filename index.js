'use strict';

// browser compatibility checker with option to fail compilation
// based on sources:
// jscc.info
// https://github.com/tbusser/jscc
// https://github.com/Fyrd/caniuse
//
// Author: Mozes Magyar, mozes.magyar@gmail.com

var gutil = require('gulp-util');
var through = require('through2');
var request = require('request');
var fs = require('fs');
var col = gutil.colors;

// regexes to match
var rules = require('./rules.js');

var browsers = {};

var statuses = {
	'y': 'Full Support',
	'n': 'No Support',
	'p': 'Support through Polyfill',
	'u': 'Unknown Support',
	'a': 'Partial Support'
};

var colours = {
	'y': col.green,
	'n': col.bgBlack.bold.red,
	'p': col.white,
	'u': col.cyan,
	'a': col.bold.yellow
};

/*
 * determine if 1 version string is greater than another
 * assumes all versions are digits separated by decimal points
 *
 * @param [v]
 */
function versionHigher (v) {

	var versions = {};

	var maxSubversionCount = 0;

	// split subversions by decimal points
	v.forEach(function (i) {
		var splitVersions = i.split('.');
		versions[i] = splitVersions;
		if (versions[i].length > maxSubversionCount) {
			maxSubversionCount = versions[i].length;
		}
	});

	// pad subversion numbers to have the same number among the version checked
	Object.keys(versions).forEach(function (i) {
		while (versions[i].length < maxSubversionCount) {
			versions[i].push('0');
		}
		versions[i] = versions[i].map(function (j) {return '.'+j});
	});

	// go through and find the highest version
	while (1) {
		var maxVersionIndex = '';
		var maxVersion = 0;
		var isDifferent;
		Object.keys(versions).forEach(function (i) {

			var currentSubversion = versions[i].shift();

			// all input versions are the same, return any of them
			if (typeof currentSubversion === 'undefined') {
				isDifferent = true;
				maxVersion = currentSubversion;
				maxVersionIndex = i;

			// first iteration through
			} else if (maxVersionIndex === '') {
				maxVersionIndex = i;
				maxVersion = currentSubversion;

			} else if (Number(maxVersion) > Number(currentSubversion)) {
				isDifferent = true;

			// new biggest version
			} else if (Number(maxVersion) < Number(currentSubversion)) {
				isDifferent = true;
				maxVersionIndex = i;
				maxVersion = currentSubversion;

			}
		});

		if (isDifferent) {
			return maxVersionIndex;
		}
	}
}

/*
 * check a specific browser version to see if it has specific compatibility issues
 *
 * @param match feature {browser} browserString {conf}
 */
function checkBrowserVersionForCompatibilityIssues(match, feature, browser, browserString, conf) {

	/*
	 * check this specific version for issues
	 * @param {problems} version
	 */
	var closure = function (problems, version) {
		var browserConf = conf[browserString] || {};

		var versionRange = version.split('-');

		// if this browser version is below reporting version, don't bother checking
		if (typeof browserConf.report !== 'undefined' && browserConf.report !== versionRange[versionRange.length - 1] && browserConf.report === versionHigher([versionRange[versionRange.length - 1], browserConf.report])) {
			return problems;
		}

		// get the 1 character issue status
		var browserStatus = feature.stats[browserString][version].substr(0,1).toLowerCase();

		switch (browserStatus) {
			case 'n':
				// no support for this feature in this browser and this needs to pass makes it a failure
				if (typeof browserConf.fail !== 'undefined' && (browserConf.report === versionRange[0] || browserConf.fail !== versionHigher([versionRange[0], browserConf.fail]))) {
					problems.failure = true;
				}
			case 'u':
			case 'p':
			case 'a':

				// store match for reporting
				problems.features = problems.features || {};
				problems.features[match] = feature;

				problems.browsers = problems.browsers || {};
				problems.browsers[browser] = problems.browsers[browser] || {};
				problems.browsers[browser][version] = problems.browsers[browser][version] || {};
				problems.browsers[browser][version][match] = {};

				problems.browsers[browser][version][match].status = browserStatus;

				problems.browsers[browser][version][match].notes = feature.stats[browserString][version].split(' ').filter(function (a) {
					return a.substr(0,1)==='#';
				}).map(function (a) {
					return feature.notes_by_num[a.substr(1)];
				});

			default:
				break;
		}

		return problems;
	}

	return closure;
}

/*
 * check a specific browser for compatibility issues
 *
 * @param match feature {conf}
 */
function checkBrowserForCompatibilityIssues(match, feature, conf) {

	/*
	 * check a given browser for compatibility issues
	 *
	 * @param {problems} browserString
	 */
	var closure = function (problems, browserString) {

		if (typeof conf[browserString] === 'undefined' && conf.ignore_unlisted) {
			return problems;
		}

		return Object.keys(feature.stats[browserString]).reduce(checkBrowserVersionForCompatibilityIssues(match, feature, browsers[browserString].browser, browserString, conf), problems);
	};

	return closure;
}

/*
 * check all browsers for compatibility issues
 *
 * @param {features} {conf}
 */
function checkForCompatibilityIssues(features, conf) {

	/*
	 * check all browsers for compatibility issues
	 *
	 * @param {problems} match
	 */
	var closure = function (problems, match) {
		return Object.keys(features[match].stats).reduce(checkBrowserForCompatibilityIssues(match, features[match], conf), problems);
	}

	return closure;
}

/*
 * check incoming source code for possible browser compatibility issues
 *
 * @param src {features} {conf}
 */
function compat(src, features, conf) {

	var notBrowserConfigs = {
		'ignore_unlisted': 1,
		'dont_download': 1
	};

	// make sure that report version >= fail version
	conf = Object.keys(conf).reduce(function (obj, key) {

		var val = conf[key];

		if (notBrowserConfigs[key]) {

		} else if (typeof val.report === 'undefined' && typeof val.fail === 'undefined') {

		} else if (typeof val.report === 'undefined') {
			val.report = val.fail
		} else if (typeof val.fail === 'undefined') {

		} else if (val.report === versionHigher([val.report, val.fail])) {
			val.report = val.fail;
		}

		obj[key] = val;

		return obj;

	}, {});

	// test code to find which potentially-incompatible features exist
	var matches = Object.keys(features).reduce(function (matches, feature) {

		var testPass = typeof rules[feature] !== 'undefined' && Object.keys(rules[feature]).some(function (test) {
			return rules[feature][test].test(src);
		});

		if (testPass) {
			matches.push(feature);
		}

		return matches;

	}, []);

	var failure;

	// find version information for matching potential issue
	var problems = matches.reduce(checkForCompatibilityIssues(features, conf), {});

	var problematicFeatures = problems.features;
	var problematicBrowsers = problems.browsers;
	var failure = problems.failure;

	if (typeof problematicFeatures === 'undefined') {
		gutil.log('finished browser compatibility check: No Problems!');
		return;
	}


	// group all version of each browser that have the same issues
	problematicBrowsers = Object.keys(problems.browsers).reduce(function (problematicBrowsers, browser) {

		// group each version of this browser that have the same issues
		var versionGroups = Object.keys(problems.browsers[browser]).reduce(function (versionGroups, version) {
			var ordered = Object.keys(problems.browsers[browser][version]).sort().map(function (feature) {
				return {'key': feature, 'val': problems.browsers[browser][version][feature]};
			});

			versionGroups[JSON.stringify(ordered)] = versionGroups[JSON.stringify(ordered)] || [];
			versionGroups[JSON.stringify(ordered)].push(version);

			return versionGroups;

		}, {});

		// make the final group keys by joining version
		problematicBrowsers[browser] = Object.keys(versionGroups).reduce(function (problematicBrowser, group) {

			var versions = versionGroups[group];
			problematicBrowser[versions.join(', ')] = problems.browsers[browser][versions[0]]

			return problematicBrowser;
		}, {});

		return problematicBrowsers;
	}, {});

	// create browser-version-feature string for issues
	var issues = Object.keys(problematicBrowsers).reduce(function (browserIssues, browser) {

		browserIssues += 'Browser: ' + browser + '\n';

		// create version-feature string for issues for this browser
		browserIssues +=  Object.keys(problematicBrowsers[browser]).reduce(function (versionIssues, version) {

			versionIssues += '\tVersion: ' + version + '\n';

			// create feature string for issues for this browser version
			versionIssues += Object.keys(problematicBrowsers[browser][version]).reduce(function (featureIssues, feature) {

				var stat = problematicBrowsers[browser][version][feature].status;
				var featureLine = features[feature].title + ':' + colours[stat](statuses[stat]);

				featureIssues += '\t\t' + featureLine;

				// extra notes if they exist
				if (problematicBrowsers[browser][version][feature].notes.length) {
					featureIssues += ' - ' + problematicBrowsers[browser][version][feature].notes.join(', ').replace(/[\r\n]+/gm, '\n\t\t' + Array((featureLine + ' - ').length + 1).join(' '));
				}

				featureIssues += '\n';

				return featureIssues;
			}, '');

			return versionIssues;

		}, '');

		return browserIssues;
	}, '');

	gutil.log('Encountered the following browser compatibility issues:\n' + issues);

	// create summary of encountered issues
	var summary = Object.keys(problematicFeatures).reduce(function (summary, feature) {

		var featureInfo = problematicFeatures[feature];

		summary += featureInfo.title + '\n\t\t' + featureInfo.description + '\n';

		if (featureInfo.notes.length) {
			summary += '\tNotes:\n\t\t' + featureInfo.notes.replace(/[\r\n]+/gm, '\n\t\t');
		}

		summary += '\n';

		return summary;
	}, '');

	gutil.log('Summary:\n' + summary);

	if (failure) {
		throw 'Code is incompatible with minimum browser version';
	}

	gutil.log('finished browser compatibility check');
}

/*
 * parse compatibility info from files
 *
 * @param src {conf} [{files}]
 */
function parseCompatFiles(src, conf, files) {

	// read file data and move them to backup file names
	files = files.map(function (fileInfo) {

		var filename = "node_modules/gulp-browser-compat/" + fileInfo.file;
		var newFilename = "node_modules/gulp-browser-compat/" + fileInfo.file + '.new';

		try {
			// copy most-recently-downloaded data file
			fileInfo.data = JSON.parse(fs.readFileSync(newFilename));

			// make backup copy of file
			fs.createReadStream(newFilename).pipe(fs.createWriteStream(filename));

		} catch (parseError) {
			gutil.log('unable to parse file "' + filename + '.new" (downloaded from ' + fileInfo.url + '), reason: ', parseError);
			// use backup copy of file
			try {
				fileInfo.data = JSON.parse(fs.readFileSync(filename));
			} catch (backupFileError) {
				gutil.log('skipping missing file "' + filename + '"');
				return false;
			}
		}



		return fileInfo;
	}).filter(function (fileInfo) {
		return fileInfo !== false;
	});

	// get information for browsers for reporting
	browsers = files.filter(function (fileInfo) {
		return fileInfo.extension && fileInfo.data.agents;

	}).map(function (fileInfo) {
		return fileInfo.data.agents;

	}).reduce(function (browsers, agentObj) {

		browsers = Object.keys(agentObj).reduce(function (browsers, agent) {
			browsers[agent] = agentObj[agent];

			return browsers;
		}, browsers);

		return browsers;
	}, {});

	var specifiedCategories = {
		'JS API': true,
		'DOM': true,
		'Canvas': true
	};

	// get information about features that have compatibility issues
	var features = files.reduce(function (fileFeatures, fileInfo) {

		var data = fileInfo.data;

		if (fileInfo.extension) {
			data = data[fileInfo.extension];
		}

		fileFeatures = Object.keys(data).reduce(function (fileFeatures, feature) {

			data[feature].categories = data[feature].categories || [];

			var validCategory = data[feature].categories.reduce(function (valid, category) {

				return specifiedCategories[category] | valid;
			}, false);

			if (!fileInfo.strict || validCategory) {
				fileFeatures[feature] = data[feature];
			}

			return fileFeatures;
		}, fileFeatures);

		return fileFeatures;
	}, {});

	return compat(src, features, conf);
}

/*
 * download files with up-to-date browser compatibility information
 *
 * @param src {conf}
 */
function getCompatData (src, conf) {

	var files = [{
		'file': 'additional.json',
		'extension': 'data',
		'strict':true,
		'url': 'https://raw.githubusercontent.com/tbusser/jscc/develop/src/static/data/additional.json'
	}, {
		'file': 'caniuse2.json',
		'extension' : 'data',
		'strict':true,
		'url': 'https://raw.githubusercontent.com/tbusser/jscc/develop/src/static/data/caniuse2.json'
	}, {
		'file': 'data.json',
		'extension' : 'data',
		'strict':false,
		'url': 'https://raw.githubusercontent.com/Fyrd/caniuse/master/data.json'
	}
	];

	// use most-recently-downloaded files
	if (conf.dont_download) {
		parseCompatFiles(src, conf, files);
		return;
	}

	// closure to track when all downloads are asyncronously completed
	var incrementDownloadCount = function () {
		var downloadCount = 0;

		return function () {
			if (++downloadCount === files.length) {
				parseCompatFiles(src, conf, files);
			}
		}
	}();

	var fileDownloaded = function (err) {
		if (err) {
			gutil.log('unable to download from "' + this.url + '", using last-downloaded file: ', err);
		}

		incrementDownloadCount();
	}

	// download each data file
	files.forEach(function (fileInfo) {
		try {
			request(fileInfo.url, fileDownloaded.bind({url: fileInfo.url})).pipe(fs.createWriteStream('node_modules/gulp-browser-compat/' + fileInfo.file + '.new'));
		} catch (e) {

			gutil.log('unable to download from "' + fileInfo.url + '", using last-downloaded file: ', e);
			incrementDownloadCount();
		}
	});

	return;
}

module.exports = function (conf) {
	return through.obj(function (file, enc, cb) {
		if (file.isNull()) {
			cb(null, file);

			return;
		}

		if (file.isStream()) {
			cb(new gutil.PluginError('gulp-browser-compat', 'Streaming not supported'));

			return;
		}

		conf = conf || {'ignore_unlisted':false};

		if (Object.keys(conf).length === 0) {
			gutil.log('No Browser Compatibility Check Requested');
			cb();

			return;
		}

		conf.ignore_unlisted = conf.ignore_unlisted || false;
		conf.dont_download = conf.dont_download || false;

		try {
			file.contents = new Buffer(file.contents.toString());
			getCompatData(file.contents,conf);
			this.push(file);
		} catch (err) {
			this.emit('error', new gutil.PluginError('gulp-browser-compat', err, {fileName: file.path}));
		}

		cb();
	});
};
