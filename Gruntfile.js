/**
 */
'use strict';

var AWS = require('aws-sdk');
var is_new_template = false;

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

var cloudformation;
var s3;

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

var read_stack_region = function(stack) {
	return cloudformation.describeStacks({'StackName' : stack}).promise()
	.then(function(stack_info) {
		return stack_info.data.Stacks[0].StackId.split(':')[3];
	});
};

var onlyUnique = function(value, index, self) {
	return self.indexOf(value) === index;
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
		return resource.ResourceType == 'AWS::SQS::Queue' ||
				resource.ResourceType == 'AWS::SNS::Topic'
	});
	var key = resources.filter(function(resource) {
		return resource.ResourceType == 'AWS::KMS::Key';
	});
	var rule = resources.filter(function(resource) {
		return resource.ResourceType == 'AWS::Events::Rule';
	});
	var stepfunctions = resources.filter(function(resource) {
		return resource.ResourceType == 'AWS::StepFunctions::StateMachine';
	});
	var stack_conf = { 	'stack' : stack,
						'functions' : make_lookup(lambdas),
						'keys' : make_lookup(key),
						'tables' : make_lookup(dynamodbs),
						'buckets' : make_lookup(buckets),
						'queue' : make_lookup(queue),
						'stepfunctions' : make_lookup(stepfunctions),
						'rule'  : make_lookup(rule) };
	return stack_conf;
};

module.exports = function(grunt) {

	AWS.config.update({region:'us-east-1'});

	if (grunt.option('region')) {
		AWS.config.update({region:grunt.option('region')});
	}

	require('load-grunt-tasks')(grunt);

	grunt.loadNpmTasks('grunt-confirm');
	grunt.loadNpmTasks('grunt-bumpup');

	require('./tasks/auth0init')(grunt);


	cloudformation = new AWS.CloudFormation();
	s3 = new AWS.S3();

	var path = require('path');
	grunt.initConfig({
		confirm: {
			update_cloudformation: {
				options: {
					question: 'Do you want to deploy the template? :',
					input: '_key:y' // Continue the flow if `Y` key is pressed.
				}
			}
		},
		bumpup: { options : { updateProps: { pkg: 'package.json' }}, file: 'package.json' },
		tagrelease: {
			version: '<%= pkg.version %>',
			commit: true,
			file: 'package.json'
		},
		grunt: {
		}
	});

	grunt.registerTask('release', function (type) {
		type = type ? type : 'patch';     // Default release type
		grunt.task.run('bumpup:' + type); // Bump up the version
		grunt.task.run('tagrelease');     // Commit & tag the release
		grunt.task.run('releaseLambda');
		grunt.task.run('pushLambdas');
	});

	grunt.registerTask('releaseLambda', function () {
		let lambda_modules = Object.keys(grunt.file.readJSON('package.json').dependencies).filter( dep => {
			return dep.indexOf('lambda') >= 0;
		}).map( dep => `node_modules/${dep}`);
		lambda_modules.forEach(function(module) {
			grunt.task.run('taglambda:'+module);
		});
	});
	grunt.registerTask('taglambda', function (dir) {
		var version = grunt.file.readJSON('package.json').version;
		let lambda_modules = Object.keys(grunt.file.readJSON('package.json').dependencies).filter( dep => {
			return dep.indexOf('lambda') >= 0;
		}).map( dep => `node_modules/${dep}`);

		var done = this.async();

		grunt.log.writeln('tagging ' + dir);

		grunt.util.spawn({
			cmd: 'git',
			args:['tag','-a','glycodomain-'+version+'','-m','"Release glycodomain-'+version+'"'],
			opts: {
				cwd: dir
			}
		},

		function(err, result, code) {
			if (err == null) {
				grunt.log.writeln('Tagged ' + dir);
				grunt.log.writeln(result.stdout);
				done();
			}
			else {
				grunt.log.writeln('Tagging ' + dir + ' failed: ' + code);
				grunt.log.writeln(result.stderr);
				done(false);
			}
		});
	});

	grunt.registerTask('pushLambdas', function () {
		let lambda_modules = Object.keys(grunt.file.readJSON('package.json').dependencies).filter( dep => {
			return dep.indexOf('lambda') >= 0;
		}).map( dep => `node_modules/${dep}`);
		lambda_modules.forEach(function(module) {
			grunt.task.run('pushLambda:'+module);
		});
	});
	grunt.registerTask('pushLambda', function (dir) {
		var version = grunt.file.readJSON('package.json').version;
		let lambda_modules = Object.keys(grunt.file.readJSON('package.json').dependencies).filter( dep => {
			return dep.indexOf('lambda') >= 0;
		}).map( dep => `node_modules/${dep}`);
		var done = this.async();

		grunt.log.writeln('pushing ' + dir);

		grunt.util.spawn({
			cmd: 'git',
			args:['push','--follow-tags'],
			opts: {
				cwd: dir
			}
		},

		function(err, result, code) {
			if (err == null) {
				grunt.log.writeln('Pushed ' + dir);
				grunt.log.writeln(result.stdout);
				done();
			}
			else {
				grunt.log.writeln('Pushing ' + dir + ' failed: ' + code);
				grunt.log.writeln(result.stderr);
				done(false);
			}
		});
	});


	grunt.registerTask('uploadlambda', function(dir) {
		var done = this.async();

		grunt.log.writeln('processing ' + dir);

		grunt.util.spawn({
			grunt: true,
			args:['deploy'],
			opts: {
				cwd: dir
			}
		},

		function(err, result, code) {
			if (err == null) {
				grunt.log.writeln('Uploaded ' + dir);
				grunt.log.writeln(result.stdout);
				done();
			}
			else {
				grunt.log.writeln('Uploading ' + dir + ' failed: ' + code);
				grunt.log.writeln(result.stdout);
				done(false);
			}
		})
	});


	grunt.registerTask('get_resources', 'Get CloudFormation resources', function(stack) {
		var done = this.async();
		stack = stack || 'test';
		read_stack_resources(stack).then(function(resources) {
			return read_stack_region(stack).then(function(region) {
				var summary = summarise_resources(stack,resources);
				summary.region = region;
				grunt.file.write(stack+'-resources.conf.json',JSON.stringify(summary,null,'  '));
				done();
			});
		});
	});

	grunt.registerTask('copy_configs', 'Copy master lambda conf to target lambdas', function(stack) {
		let lambda_modules = Object.keys(grunt.file.readJSON('package.json').dependencies).filter( dep => {
			return dep.indexOf('lambda') >= 0;
		}).map( dep => `node_modules/${dep}`);
		lambda_modules.forEach(function(module) {
			grunt.file.copy(stack+'-resources.conf.json',module+'/resources.conf.json');
		});
	});

	grunt.registerTask('upload_lambdas', 'Upload lambdas only', function(stack) {
		if (grunt.option('generate-changeset')) {
			return;
		}
		let lambda_modules = Object.keys(grunt.file.readJSON('package.json').dependencies).filter( dep => {
			return dep.indexOf('lambda') >= 0;
		}).map( dep => `node_modules/${dep}`);
		lambda_modules.forEach(function(module) {
			grunt.task.run('uploadlambda:'+module);
		});
	});

	grunt.registerTask('update_configs','Retrieve resources and set config files in place', function(stack) {
		grunt.task.run('get_resources:'+stack);
		grunt.task.run('copy_configs:'+stack);
	});

	grunt.registerTask('deploy_lambdas', 'Retrieve resources, copy configs and deploy to AWS', function(stack) {
		grunt.task.run('update_configs:'+stack);
		grunt.task.run('upload_lambdas:'+stack);
	});

	grunt.registerTask('get_current_template','Get cloudformation template',function(stack) {
		var done = this.async();
		cloudformation.getTemplate({'StackName' : stack}).promise().then((response) => {
			grunt.file.write(stack+'_last.template',response.data.TemplateBody,null,'  ');
			done();
		}).catch( err => {
			console.error(err);
		});
	});

	grunt.registerTask('compare_templates','Compare two CloudFormation templates',function(stack) {
		grunt.task.run('get_current_template:'+stack);
		grunt.task.run('diff_template:'+stack);
	});

	grunt.registerTask('update_cloudformation','',function() {
		var stack = grunt.option('stack');
		var done = this.async();
		var stackconfig = require('./'+stack+'-resources.conf.json');
		if (grunt.option('generate-changeset')) {
			var key = (new Date()).getTime()+'glycodomain.template';
			var template_body = grunt.file.read('glycodomain.template');
			s3.putObject({ Bucket: stackconfig.buckets.codeupdates, Key: 'templates/'+key, Body: template_body }).promise().then(() => {
				console.log("Created template on S3, initiating changeset");
				var params_options = Object.keys(JSON.parse(template_body).Parameters).
					filter( param_name => (grunt.option('new-parameters') || []).indexOf(param_name) < 0 ).
					map( param_name => { return { ParameterKey: param_name, UsePreviousValue: true }; });
				return cloudformation.createChangeSet({ChangeSetName: stack+'-patch', Capabilities: ['CAPABILITY_NAMED_IAM'], StackName: stack, Parameters: params_options, TemplateURL: 'https://s3.amazonaws.com/'+stackconfig.buckets.codeupdates+'/templates/'+key }).promise().then((response) => {
					console.log(response.data);
				});
			}).catch((err) => {
				if (err.code == 'ValidationError' && err.message.indexOf('Circular dependency') >= 0) {
					grunt.log.writeln("Circular dependency, trying to deploy again breaking circular");
					if ( ! grunt.option('break_circular')) {
						grunt.option('break_circular',true);
						grunt.task.run('deploy_stack:'+stack);
					}
				} else {
					console.error(err);
				}
			}).then(() => done() );;
		} else {
			done();
		}
	});

	grunt.registerTask('deploy_stack','Deploy CloudFormation to a stack',function(stack) {
		grunt.option('stack',stack);
		grunt.task.run('build_cloudformation');
		grunt.task.run('compare_templates:'+stack);
		grunt.task.run('update_cloudformation');
	});

	grunt.registerTask('diff_template','Diff two CloudFormation templates',function(stack) {
		const CLOUDFORMATION_SCHEMA = require('cloudformation-js-yaml-schema').CLOUDFORMATION_SCHEMA;
		const yaml = require('js-yaml');
		let last_data = JSON.parse(JSON.stringify(yaml.safeLoad(grunt.file.read(stack+'_last.template'),{schema: CLOUDFORMATION_SCHEMA })));
		let current_data = JSON.parse(JSON.stringify(yaml.safeLoad(grunt.file.read('glycodomain.template'),{schema: CLOUDFORMATION_SCHEMA })));
		let diff = require('rus-diff').rusDiff(last_data,current_data);
		if (Object.keys(diff).length !== 0) {
			grunt.log.writeln(JSON.stringify(diff));
			grunt.option('generate-changeset',true);
			grunt.option('new-parameters', Object.keys(diff["$set"] || {}).filter( key => key.indexOf('Parameter') == 0 ).map( key => key.replace(/Parameters\./,'')));
		}
	});

	grunt.registerTask('build_cloudformation', 'Build cloudformation template',function() {
	});

	grunt.registerTask('deploy','Deploy software to AWS',function(stack) {
		grunt.task.run(['deploy_stack:'+stack,'deploy_lambdas:'+stack]);
	});
};
