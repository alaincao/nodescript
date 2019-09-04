
const gulp = require('gulp');
const del = require('del');
const chmod = require('gulp-chmod');
const header = require('gulp-header');
const browserify = require('browserify');
const tsify = require('tsify');
const uglify = require('gulp-uglify');
const source = require('vinyl-source-stream');
const buffer = require('vinyl-buffer');
const sourcemaps = require('gulp-sourcemaps');

// 'requires' NOT included by browserify (i.e. everything in node_modules):
const externals = [
					'azure-storage',
					'buffer',
					'child_process',
					'electron',
					'fs',
					'glob',
					'hjson',
					'http',
					'https',
					'jquery',
					'jsdom',
					'json5',
					'knockout',
					'moment',
					'path',
					'process',
					'unzipper',
					'url',
				];

gulp.task( 'test.js',					function(){ return compileTypeScript('./test.ts',				'test.js',					'./', false,	true); });
gulp.task( 'testGui.js',				function(){ return compileTypeScript('./testGui.ts',			'testGui.js',				'./', false,	false); });
gulp.task( 'default', gulp.parallel(
					'testGui.js',
					'test.js',
				) );

gulp.task( 'clean', function()
{
	return del( [	'./test*.js',
					'./test*.map',
					'./testGui*.js',
					'./testGui*.map',
				] );
} );

gulp.task( 'watch', function()
{
	gulp.watch( ['./**/*.ts'], ['default'] );
} );
gulp.task( 'watch.test', function()
{
	gulp.watch( ['./**/*.ts'], ['test.js'] );
} );

function compileTypeScript(entryPoint, destFileName, destDir, releaseMode, executable)
{
	var tsifyParms = {	noImplicitUseStrict: true,
						// target: 'es5', lib: [ 'dom', 'es5', 'ES2015.Promise', 'ES2016.Array.Include', 'ES2015.Iterable' ],  <== Would need to manually include some libraries
						// target: 'es2016',
						target: 'es2017',
					};
	if( releaseMode )
	{
		tsifyParms.noImplicitAny = true;
		tsifyParms.noUnusedLocals = true;
	}
	var b = browserify({ debug:true, detectGlobals: false, })
 				.add( entryPoint )
				.external( externals )
				.plugin( tsify, tsifyParms );

	var stream = b.bundle()  // Execute Browserify
			.pipe( source(destFileName) );
	if( executable )
		stream = stream
			.pipe( header('#!/usr/bin/env node\n\n') );
	stream = stream
			.pipe( buffer() )
			.pipe( sourcemaps.init({ loadMaps: true }) );
//	if( releaseMode )
//		stream = stream
//			.pipe( uglify() );  // Execute uglify   <<== Does not work with 'target:es6'
	stream = stream
			.on( 'error', function(error){ console.error(error.toString()); } )
			.pipe( sourcemaps.write('./') );
	if( executable )
		stream = stream
			.pipe( chmod(0o755) );
	stream = stream
			.pipe( gulp.dest(destDir) );
	return stream;
};
