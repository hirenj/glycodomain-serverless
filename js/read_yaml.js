const CLOUDFORMATION_SCHEMA = require('cloudformation-js-yaml-schema').CLOUDFORMATION_SCHEMA;

const REF_TYPE = require('cloudformation-js-yaml-schema').CLOUDFORMATION_SCHEMA.compiledTypeMap.scalar['!Ref'];

const assert = require('assert');

const yaml_include = require('yaml-include');

const YAML_INCLUDE_SCHEMA = yaml_include.YAML_INCLUDE_SCHEMA;

const yaml = require('js-yaml');

const exec = require('child_process').exec;

const CFN_SCHEMA = new yaml.Schema({
  include: [ CLOUDFORMATION_SCHEMA, YAML_INCLUDE_SCHEMA ]
});

yaml_include.YAML_INCLUDE_SCHEMA = CFN_SCHEMA;

const glob = require('glob');

const fs = require('fs');
const path = require('path');

const find_keys = function(keyname, object) {
  let results;
  if (Array.isArray(object)) {
    results = object.map(find_keys.bind(null,keyname)).reduce( (a, b) => {
      a = a || [];
      b = b || [];
      return a.concat(b);
    },[]);
    return results.filter( val => val );
  }
  results = [];
  if (typeof object == 'object') {
    if (object.class == keyname) {
      results.push(object.data);
    }
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

const find_non_aws_refs = function(resources) {
  let vals = find_keys('Ref',resources);
  return vals.filter( val => {
    return ! val.match(/^AWS::/);
  }).filter(onlyUnique);
};

const onlyUnique = function(value, index, self) {
  return self.indexOf(value) === index;
};

const fill_parameters = function(template) {
  let current_params = Object.keys(template.Parameters || {});
  let defined_resources = Object.keys(template.Resources || {});
  let references = find_non_aws_refs(template.Resources);
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

const enable_cors = template => {
  let resources = Object.keys(template.Resources);
  let methods = resources.filter(function(res) { return template.Resources[res].Type === 'AWS::ApiGateway::Method' });

  methods.forEach(function(method) {
    make_cors(template.Resources,method);
    let resource = template.Resources[method];
    if (resource.Properties.HttpMethod === 'HEAD') {
      return;
    }
    let method_base = method.replace(/POST/,'').replace(/GET/,'');
    if (template.Resources[method_base+'OPTIONS']) {
      return;
    }
    let options_method = JSON.parse(JSON.stringify(resource));
    options_method.Properties.RestApiId = REF_TYPE.construct(options_method.Properties.RestApiId.data);
    options_method.Properties.ResourceId = REF_TYPE.construct(options_method.Properties.ResourceId.data);
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
    template.Resources[method_base+'OPTIONS'] = options_method;
  });
};

const make_cors = function(resources,method) {
  let resource  = resources[method];
  resource.Properties.Integration.IntegrationResponses.forEach(int_resp => {
    int_resp.ResponseParameters = int_resp.ResponseParameters || {};
    int_resp.ResponseParameters['method.response.header.Access-Control-Allow-Origin'] = "'*'";
  });
  resource.Properties.MethodResponses.forEach( method_resp => {
    method_resp.ResponseParameters = method_resp.ResponseParameters || {};
    method_resp.ResponseParameters['method.response.header.Access-Control-Allow-Origin'] = true;
  });
};

const fix_deployment_dependency = template => {
  let methods = Object.keys(template.Resources).filter( resource =>  template.Resources[resource].Type == 'AWS::ApiGateway::Method' );
  template.Resources['productionDeployment'].DependsOn = methods;
}

const combine_resources = (curr,prev) => {
  Object.keys(curr).forEach(function(key) {
    if (prev[key] && prev[key].Type == 'AWS::S3::Bucket') {
      let wanted = null;
      let alternative = null;
      if (prev[key].Properties.BucketName) {
        wanted = prev[key];
        alternative = curr[key];
      }
      if (curr[key].Properties.BucketName) {
        wanted = curr[key];
        alternative = prev[key];
      }
      prev[key] = wanted;
      if (! wanted.Properties.NotificationConfiguration && alternative.Properties.NotificationConfiguration ) {
        wanted.Properties.NotificationConfiguration = {}
      }
      wanted.Properties.NotificationConfiguration.LambdaConfigurations = (wanted.Properties.NotificationConfiguration.LambdaConfigurations || []).concat( alternative.Properties.NotificationConfiguration.LambdaConfigurations );
      wanted.DependsOn = (wanted.DependsOn || []).concat(alternative.DependsOn)
      curr[key] = prev[key];
    }
    if (prev[key] && prev[key].Type == 'AWS::SNS::Topic') {
      curr[key].Properties.Subscription = curr[key].Properties.Subscription.concat(prev[key].Properties.Subscription);
    }
    prev[key] = curr[key];
  });
  return prev;
};

const combine_stacks = (stack, sub_template) => {
  stack.Parameters = Object.assign(sub_template.Parameters || {},stack.Parameters);
  stack.Resources = combine_resources(sub_template.Resources || {},stack.Resources);
  stack.Outputs = Object.assign(sub_template.Outputs || {},stack.Outputs);
};

let stack = yaml.safeLoad(fs.readFileSync('stack_definition.yaml'));

let sub_templates = glob.sync('resources/*.yaml');

for (let template of sub_templates) {
  let template_string = fs.readFileSync(template);
  let sub_template = yaml.safeLoad(template_string, { schema: CFN_SCHEMA });
  if (sub_template.AWSTemplateFormatVersion === '2010-09-09') {
    combine_stacks(stack,sub_template);
  } else if (sub_template.modules) {
    for (let mod in sub_template.modules) {
      combine_stacks(stack,sub_template.modules[mod]);
    }
  }
}

enable_cors(stack);
let options_stack = yaml.safeLoad(fs.readFileSync('stack_definition.yaml'));

for (let key of Object.keys(stack.Resources)) {
  if (stack.Resources[key].Type === 'AWS::ApiGateway::Method' && stack.Resources[key].Properties.HttpMethod == 'OPTIONS') {
    options_stack.Resources[key] = stack.Resources[key];
    delete options_stack.Resources[key].DependsOn;
    delete stack.Resources[key];
  }
}

fill_parameters(options_stack);

if (stack.Resources['optionsStack']) {
  for (let key of Object.keys(options_stack.Parameters)) {
    stack.Resources['optionsStack'].Properties.Parameters[key] = REF_TYPE.construct(key);
  }
}


let users_stack = yaml.safeLoad(fs.readFileSync('stack_definition.yaml'));

for (let template of glob.sync('resources/iam_users/*.yaml')) {
  let template_string = fs.readFileSync(template);
  let sub_template = yaml.safeLoad(template_string, { schema: CFN_SCHEMA });
  if (sub_template.AWSTemplateFormatVersion === '2010-09-09') {
    combine_stacks(users_stack,sub_template);
  } else if (sub_template.modules) {
    for (let mod in sub_template.modules) {
      combine_stacks(users_stack,sub_template.modules[mod]);
    }
  }
}

fill_parameters(users_stack);

if (stack.Resources['usersStack']) {
  for (let key of Object.keys(users_stack.Parameters)) {
    if ( ! stack.Resources['usersStack'].Properties.Parameters[key] ) {
      stack.Resources['usersStack'].Properties.Parameters[key] = REF_TYPE.construct(key);
    }
  }
}

fill_parameters(stack);

fix_deployment_dependency(stack);

let git_command = 'git describe --long --tags HEAD';

console.log('Getting git status');

let get_git_status = () => {
  return new Promise( (resolve,reject) => {
    console.log(git_command);
    exec(git_command,(err,stdout) => {
      if (err) {
        reject(err);
      }
      resolve(String(stdout).trim());
    });
  });
};


module.exports = get_git_status().then( git_status => {

  let status = git_status.replace(/-0-[^-]+$/,'');

  stack.Description = `Glycodomain ${status}`;
  options_stack.Description = `Glycodomain API options ${status}`;

  let clean_filename = stack.Description.replace(/[^A-Za-z0-9_\-]/g,'_');

  let users_filename = `${clean_filename.replace('Glycodomain','Glycodomain_users')}.template`;
  let options_filename = `${clean_filename.replace('Glycodomain','Glycodomain_options')}.template`;
  for (let [entry, substack] of Object.entries(stack.Resources).filter( ([entry,res]) => { return ['optionsStack','usersStack'].indexOf(entry) >= 0 } ) ) {
    switch (entry) {
      case "optionsStack":
        substack.Properties.TemplateURL.data = substack.Properties.TemplateURL.data.replace(/glycodomain_options.template/, options_filename );
        break;
      case "usersStack":
        substack.Properties.TemplateURL.data = substack.Properties.TemplateURL.data.replace(/glycodomain_users.template/, users_filename );
        break;
    }
  }

  let generated_yaml_string = yaml.safeDump(stack, {schema: CLOUDFORMATION_SCHEMA });

  fs.writeFileSync('glycodomain.template',generated_yaml_string);

  fs.writeFileSync(options_filename, yaml.safeDump(options_stack, {schema: CLOUDFORMATION_SCHEMA }));

  fs.writeFileSync(users_filename, yaml.safeDump(users_stack, {schema: CLOUDFORMATION_SCHEMA }));

});