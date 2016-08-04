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

var cloudformation = new AWS.CloudFormation({region:'us-east-1'});

var new_resources_func = function(stack,resources) {
	if (resources.data.NextToken) {
		return cloudformation.listStackResources({'StackName' : stack, 'NextToken' : resources.data.NextToken }).promise()
		.then(new_resources_func.bind(null,stack))
		.then(function(nextpage) {
			return resources.data.StackResourceSummaries.concat(nextpage);
		});
	} else {
		return resources.data.StackResourceSummaries;
	}
};

var read_stack_resources = function(stack) {
	return cloudformation.listStackResources({ 'StackName' : stack }).promise()
	.then(new_resources_func.bind(null,stack))
	.catch(function(err) {
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
	var queue = resources.filter(function(resource) {
		return 	resource.ResourceType == 'AWS::SQS::Queue' ||
				resource.ResourceType == 'AWS::SNS::Topic'
	});
	var stack_conf = { 	'stack' : stack,
						'functions' : make_lookup(lambdas),
						'tables' : make_lookup(dynamodbs),
						'buckets' : make_lookup(buckets),
						'queue' : make_lookup(queue) };
	return stack_conf;
}

module.exports = function(grunt) {
	require('load-grunt-tasks')(grunt);

	var path = require('path');
	grunt.initConfig({
		grunt: {
			deploy_jwt: {
				gruntfile: 'node_modules/lambda-jwt/Gruntfile.js',
				task: 'deploy'
			},
			deploy_syncgroups: {
				gruntfile: 'node_modules/lambda-syncgroups/Gruntfile.js',
				task: 'deploy'
			},
			deploy_gatordata: {
				gruntfile: 'node_modules/lambda-gatordata/Gruntfile.js',
				task: 'deploy'
			}
		}
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

	grunt.registerTask('deploy_lambdas', 'Deploy lambdas', function(stack) {
		var lambda_modules = grunt.file.expand('node_modules/lambda-*/');
		lambda_modules.forEach(function(module) {
			grunt.file.copy(stack+'-resources.conf.json',module+'/resources.conf.json');
		});
	});

  grunt.registerTask('deploy', 'Retrieve resources and deploy', function(stack) {
  	grunt.task.run('get_resources:'+stack);
  	grunt.task.run('deploy_lambdas:'+stack);
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
