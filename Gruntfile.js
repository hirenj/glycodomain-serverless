/**
 */
'use strict';

require('es6-promise').polyfill();
var AWS = require('aws-sdk');

AWS.Request.prototype.promise = function() {
  return new Promise(function(accept, reject) {
    this.on('complete', function(response) {
      if (response.error) {
        reject(response.error);
      } else {
        accept(response);
      }
    });
    this.send();
  }.bind(this));
};

var read_stack_resources = function(stack) {
	var cloudformation = new AWS.CloudFormation({region:'us-east-1'});
	return cloudformation.listStackResources({ 'StackName' : stack }).promise().then(function(resources) {
		return resources.data.StackResourceSummaries;
		console.log();
	}).catch(function(err) {
		console.log(err);
		console.log(err.stack);
		return Promise.resolve(true);
	});
};

var make_lookup = function(resources) {
	var result = {};
	resources.forEach(function(resource) {
		result[resource.LogicalResourceId] = resource.PhysicalResourceId;
	});
	return result;
};

var summarise_resources = function(stack,resources) {
	var lambdas = resources.filter(function(resource) {
		return resource.ResourceType == 'AWS::Lambda::Function';
	});
	var dynamodbs = resources.filter(function(resource) {
		return resource.ResourceType == 'AWS::DynamoDB::Table';
	});
	var buckets = resources.filter(function(resource) {
		return resource.ResourceType == 'AWS::S3::Bucket';
	});
	var stack_conf = { 	'functions' : make_lookup(lambdas),
						'tables' : make_lookup(dynamodbs),
						'buckets' : make_lookup(buckets) };
	return stack_conf;
}

module.exports = function(grunt) {
	require('load-grunt-tasks')(grunt);

	var path = require('path');
	grunt.initConfig({
	});

	grunt.registerTask('get_resources', 'Get CloudFormation resources', function(stack) {
		var done = this.async();
		stack = stack || 'test';
		read_stack_resources(stack).then(function(resources) {
			var summary = summarise_resources(stack,resources);
			grunt.file.write(stack+'-resources.conf.json',JSON.stringify(summary,null,'  '));
			done();
		});
	});

	grunt.registerTask('build_cloudformation', 'Build cloudformation template',function() {
		var template_paths = ['empty.template'];
		template_paths = template_paths.concat(grunt.file.expand('node_modules/*/**/resources/*.template'));
		template_paths = template_paths.concat(grunt.file.expand('resources/*.template'));
		var templates = template_paths.map(function(template) {
			return grunt.file.readJSON(template);
		});
		var common_template = templates.reduce(function(prev,curr) {
			if (! prev) {
				return curr;
			}
			if ( ! prev.Resources ) {
				prev.Resources = {};
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
		grunt.file.write('glycodomain.template',JSON.stringify(common_template,null,'  '));
	});
};
