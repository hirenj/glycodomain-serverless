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

var enable_cors = function(template) {
	var resources = Object.keys(template.Resources);
	var methods = resources.filter(function(res) { return template.Resources[res].Type === 'AWS::ApiGateway::Method' });
	methods.forEach(function(method) {
		make_cors(template.Resources,method);
		var resource = template.Resources[method];
		if (resource.Properties.HttpMethod === 'HEAD') {
			return;
		}
		var method_base = method.replace(/POST/,'').replace(/GET/,'');
		if (template.Resources[method_base+'POSTOPTIONS'] || template.Resources[method_base+'GETOPTIONS']) {
			return;
		}
		var options_method = JSON.parse(JSON.stringify(resource));
		options_method.Properties.HttpMethod = 'OPTIONS';
		if (options_method.Properties.RequestParameters) {
			delete options_method.Properties.RequestParameters['method.request.header.Authorization'];
		}
		delete options_method.Properties.ApiKeyRequired;
		options_method.Properties.Integration = {'Type' : 'MOCK'};
		options_method.Properties.Integration.RequestTemplates = { "application/json" : "{\"statusCode\": 200}" };
		options_method.Properties.Integration.IntegrationResponses = [
		{
			"ResponseParameters": {
				"method.response.header.Access-Control-Allow-Origin": "'*'",
				"method.response.header.Access-Control-Allow-Headers" : "'Content-Type,X-Amz-Date,Authorization,X-Api-Key'",
				"method.response.header.Access-Control-Allow-Credentials" : "'true'",
				"method.response.header.Access-Control-Allow-Max-Age" : "'1800'",
				"method.response.header.Access-Control-Allow-Expose-Headers" : "''",
				"method.response.header.Access-Control-Allow-Methods" : "'"+resource.Properties.HttpMethod+",OPTIONS'"
			},
			"ResponseTemplates": { 'application/json' : '' },
			"StatusCode": 200
		}];
		options_method.Properties.MethodResponses = [
		{
			"ResponseParameters": {
				"method.response.header.Access-Control-Allow-Origin": true,
				"method.response.header.Access-Control-Allow-Headers": true,
				"method.response.header.Access-Control-Allow-Credentials": true,
				"method.response.header.Access-Control-Allow-Max-Age": true,
				"method.response.header.Access-Control-Allow-Expose-Headers": true,
				"method.response.header.Access-Control-Allow-Methods": true
			},
			"StatusCode": 200
		}];
		options_method.Properties.AuthorizationType = "NONE";
		delete options_method.Properties.AuthorizerId;
		template.Resources[method+'OPTIONS'] = options_method;
	});
};

var make_cors = function(resources,method) {
	var resource  = resources[method];
	resource.Properties.Integration.IntegrationResponses.forEach(function(int_resp) {
		int_resp.ResponseParameters = int_resp.ResponseParameters || {};
		int_resp.ResponseParameters['method.response.header.Access-Control-Allow-Origin'] = "'*'";
	});
	resource.Properties.MethodResponses.forEach(function(method_resp) {
		method_resp.ResponseParameters = method_resp.ResponseParameters || {};
		method_resp.ResponseParameters['method.response.header.Access-Control-Allow-Origin'] = true;
	});
};

var find_keys = function(keyname, object) {
	if (Array.isArray(object)) {
		var results = object.map(find_keys.bind(null,keyname)).reduce( (a, b) => {
			a = a || [];
			b = b || [];
			return a.concat(b);
		},[]);
		return results.filter( val => val );
	}
	var results = [];
	if (typeof object == 'object') {
		Object.keys(object).forEach(key => {
			if (key === keyname) {
				results.push(object[key]);
			} else {
				results = results.concat(find_keys(keyname,object[key]));
			}
		});
		return results.filter( val => val );
	}
	return;
}

var find_non_aws_refs = function(resources) {
	var vals = find_keys('Ref',resources);
	return vals.filter( val => {
		return ! val.match(/^AWS::/);
	}).filter(onlyUnique);
};

var onlyUnique = function(value, index, self) {
	return self.indexOf(value) === index;
};

var fill_parameters = function(template) {
	var current_params = Object.keys(template.Parameters || {});
	var defined_resources = Object.keys(template.Resources || {});
	var references = find_non_aws_refs(template.Resources);
	current_params.forEach(param => {
		if (defined_resources.indexOf(param) >= 0) {
			delete template.Parameters[param];
		}
	});
	references.forEach( ref => {
		if (defined_resources.indexOf(ref) < 0 && current_params.indexOf(ref) < 0) {
			template.Parameters[ref] = {
				"Type" : "String",
				"Description": "Parameter " +ref
			}
		}
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

var fix_deployment_dependency = function(template) {
	var methods = Object.keys(template.Resources).filter( resource =>  template.Resources[resource].Type == 'AWS::ApiGateway::Method' );
	template.Resources['productionDeployment'].DependsOn = methods;
}

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
		var lambda_modules = grunt.file.expand('node_modules/lambda-*/');
		lambda_modules.forEach(function(module) {
			grunt.task.run('taglambda:'+module);
		});
	});
	grunt.registerTask('taglambda', function (dir) {
		var version = grunt.file.readJSON('package.json').version;
		var lambda_modules = grunt.file.expand('node_modules/lambda-*/');
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
		var lambda_modules = grunt.file.expand('node_modules/lambda-*/');
		lambda_modules.forEach(function(module) {
			grunt.task.run('pushLambda:'+module);
		});
	});
	grunt.registerTask('pushLambda', function (dir) {
		var version = grunt.file.readJSON('package.json').version;
		var lambda_modules = grunt.file.expand('node_modules/lambda-*/');
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
		var lambda_modules = grunt.file.expand('node_modules/lambda-*/');
		lambda_modules.forEach(function(module) {
			grunt.file.copy(stack+'-resources.conf.json',module+'/resources.conf.json');
		});
	});

	grunt.registerTask('upload_lambdas', 'Upload lambdas only', function(stack) {
		if (grunt.option('generate-changeset')) {
			return;
		}
		var lambda_modules = grunt.file.expand('node_modules/lambda-*/');
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
			grunt.file.write(stack+'_last.template',JSON.stringify(JSON.parse(response.data.TemplateBody),null,'  '));
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
		let diff = require('rus-diff').rusDiff(grunt.file.readJSON(stack+'_last.template'),grunt.file.readJSON('glycodomain.template'));
		if (Object.keys(diff).length !== 0) {
			grunt.log.writeln(JSON.stringify(diff));
			grunt.option('generate-changeset',true);
			grunt.option('new-parameters', Object.keys(diff["$set"] || {}).filter( key => key.indexOf('Parameter') == 0 ).map( key => key.replace(/Parameters\./,'')));
		}
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
				if (prev.Resources[key] && prev.Resources[key].Type == 'AWS::S3::Bucket') {
					var wanted = null;
					var alternative = null;
					if (prev.Resources[key].Properties.BucketName) {
						wanted = prev.Resources[key];
						alternative = curr.Resources[key];
					}
					if (curr.Resources[key].Properties.BucketName) {
						wanted = curr.Resources[key];
						alternative = prev.Resources[key];
					}
					prev.Resources[key] = wanted;
					if (! wanted.Properties.NotificationConfiguration && alternative.Properties.NotificationConfiguration ) {
						wanted.Properties.NotificationConfiguration = {}
					}
					wanted.Properties.NotificationConfiguration.LambdaConfigurations = (wanted.Properties.NotificationConfiguration.LambdaConfigurations || []).concat( alternative.Properties.NotificationConfiguration.LambdaConfigurations );
					wanted.DependsOn = (wanted.DependsOn || []).concat(alternative.DependsOn)
					curr.Resources[key] = prev.Resources[key];
				}
				if (prev.Resources[key] && prev.Resources[key].Type == 'AWS::SNS::Topic') {
					curr.Resources[key].Properties.Subscription = curr.Resources[key].Properties.Subscription.concat(prev.Resources[key].Properties.Subscription);
				}
				prev.Resources[key] = curr.Resources[key];
			});
			if ( ! prev.Outputs ) {
				prev.Outputs = {};
			}
			Object.keys(curr.Outputs || {}).forEach(function(key) {
				prev.Outputs[key] = curr.Outputs[key];
			});
			if ( ! prev.Parameters ) {
				prev.Parameters = {};
			}
			Object.keys(curr.Parameters || {}).forEach(function(key) {
				prev.Parameters[key] = curr.Parameters[key];
			});
			return prev;
		});
		if (grunt.option('break_circular')) {
			Object.keys(common_template.Resources).forEach(function(resource_name) {
				var resource = common_template.Resources[resource_name];
				if (resource.Metadata && resource.Metadata.break_circular) {
					Object.keys(resource.Metadata.break_circular).forEach(function(path_string) {
						var path = path_string.split('.').map(function(el) {
							if (! isNaN(parseInt(el))) {
								return parseInt(el);
							}
							return el;
						});
						var value = resource.Metadata.break_circular[path_string];
						var target = resource;
						while (path.length > 1) {
							target = target[path.shift()];
						}
						if (value) {
							target[path[0]] = value;
						} else {
							delete target[path[0]];
						}
					});
					resource.Metadata.break_circular = true;
				}
			});
		}
		enable_cors(common_template);
		fill_parameters(common_template);
		fix_deployment_dependency(common_template);
		grunt.file.write('glycodomain.template',JSON.stringify(common_template,null,'  '));
	});

	grunt.registerTask('deploy','Deploy software to AWS',function(stack) {
		grunt.task.run(['deploy_stack:'+stack,'deploy_lambdas:'+stack]);
	});
};
