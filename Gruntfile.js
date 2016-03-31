/**
 */
'use strict';
module.exports = function(grunt) {
	require('load-grunt-tasks')(grunt);

	var path = require('path');
	grunt.initConfig({
	});

	grunt.registerTask('build_cloudformation', 'Build cloudformation template',function() {
		var template_paths = grunt.file.expand('node_modules/*/**/resources/*.template');
		var templates = template_paths.map(function(template) {
			return grunt.file.readJSON(template);
		});
		var common_template = templates.reduce(function(prev,curr) {
			if (! prev) {
				return curr;
			}
			Object.keys(curr.Resources).forEach(function(key) {
				prev.Resources[key] = curr.Resources[key];
			});
			if ( ! prev.Outputs ) {
				prev.Outputs = {};
			}
			Object.keys(curr.Outputs || {}).forEach(function(key) {
				prev.Outputs[key] = curr.Outputs[key];
			});
			return prev;
		});
		grunt.file.write('resources/glycodomain.template',JSON.stringify(common_template,null,'  '));
	});
};
