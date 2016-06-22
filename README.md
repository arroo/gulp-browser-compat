### Usage
gulp-browser-compat provides a method for checking against known browser compatibility issues. Can customize which browsers to report on and fail compilation if no support exists for a minimum version of a browser.

package.json:
```
    "dependencies": {
        "gulp-browser-compat":"git+https://github.com/mozesmagyar/gulp-browser-compat.git#master"
    }
```
gulpfile.js:
```
var browserCompatibility = require('gulp-browser-compat');
```
```
var compatConfig = {
        'dont_download': false,
        'ignore_unlisted': true,
        'ios_saf': {
                fail:'4.15',
                report: '4.0'
        }
};

function build(options) {
        return gulp.src(entryPoint)
                .pipe(browserify(options.browserify))
                .pipe(metaScript(options.metaScript))
                .pipe(rename(buildName + '.js'))
                .pipe(gulp.dest(buildDir))
                .pipe(uglify(uglifyOptions))
                .pipe(browserCompatibility(compatConfig))
                .pipe(rename(buildName + '.min.js'))
                .pipe(gulp.dest(buildDir));
}
```
### Options
* dont_download: do not attempt to download a newer browser compatibility data file
    * true/false
* ignore_unlisted: unless a browser is explicitly listed in this config, no reporting will be done on it
    * true/false
* \<browser\>: object detailing version information to report on or fail on if there exists No Support for a feature used by the given code
    * fail/report: version strings for determining minimim supported versions
        * note that currently it only supports dotted-integer version strings

### Currently Supported Browsers
* edge: Edge
* ie: Internet Explorer
* firefox: Firefox
* chrome: Chrome
* safari: Safari
* opera: Opera
* ios_saf: iOS Safari
* op_mini: Opera Mini
* android: Android Browser
* bb: Blackberry Browser
* op_mob: Opera Mobile
* and_chr: Chrome for Android
* and_ff: Firefox for Android
* ie_mob: IE Mobile
* and_uc: UC Browser for Android
