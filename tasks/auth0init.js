'use strict';

const AWS = require('aws-sdk');

AWS.Request.prototype.promise = function() {
  return new Promise((accept, reject) => {
    this.on('complete', response => {
      if (response.error) {
        reject(response.error);
      } else {
        accept(response);
      }
    });
    this.send();
  });
};

let cloudformation;

const read_stack_parameters = function(stack) {
  return cloudformation.describeStacks({'StackName' : stack}).promise()
  .then( stack_info => {
    let result = {};
    stack_info.data.Stacks[0].Parameters.forEach(param => result[param.ParameterKey] = param.ParameterValue);
    return result;
  });
};

const get_access_token = function(auth0domain,scope) {
  let AuthenticationClient = require('auth0').AuthenticationClient;

  if ( ! process.env.AUTH0_CLIENT_ID ) {
    return Promise.reject(new Error('Missing credentials'));
  }

  let auth0 = new AuthenticationClient({
      domain: `${auth0domain}.auth0.com`,
      clientId: process.env.AUTH0_CLIENT_ID,
      clientSecret: process.env.AUTH0_CLIENT_SECRET
  });

  return new Promise( (resolve,reject) => {
    auth0.clientCredentialsGrant({
        audience: `https://${auth0domain}.auth0.com/api/v2/`
        // scope: scope
    }, function (err, response) {
      if (err) {
        reject(err);
      } else {
        resolve(response.access_token);
      }
    });
  });
};

const get_management_client = function(auth0domain,scope) {
    let ManagementClient = require('auth0').ManagementClient;
    return get_access_token(auth0domain,scope).then( token => {
        let management = new ManagementClient({
          token: token,
          domain: `${auth0domain}.auth0.com`
        });
        return management;
    });
};

module.exports = function (grunt) {

    cloudformation = new AWS.CloudFormation();

    let DESC = 'Creates Auth0 resource server for stack';
    let DEFAULTS = {
        desc: DESC
    };

    grunt.registerTask('registerAuth0ResourceServer', DEFAULTS.desc, function (stack) {

        let done = this.async();
        let opts = this.options(DEFAULTS);


        let data = {
          "name": `${stack} stage auth server`,
          "identifier": `https://${stack}.glycocode.com`,
          "scopes": [
            {"value": "download:all_data", "description": "Download all data"},
            {"value": "download:subset_data", "description": "Download only a subset of data"},
            {"value": "query:all", "description": "Perform queries for all data"}
          ],
          "allow_offline_access": true,
          "skip_consent_for_verifiable_first_party_clients": true
        };

        let get_client = read_stack_parameters(stack).then(function(params) {
          data.identifier = params.AUTH0_API_IDENTIFIER || `https://${stack}.glycocode.com`;
          return params.AUTH0DOMAIN;
        }).then( domain => get_management_client(domain,'create:resource_servers read:resource_servers') );

        get_client.then( management => {
          management.resourceServers.create(data, function (err) {
              if (err) {
                  // Handle error.
                  console.log(err);
              }
              done();
          });
        }).catch( err => {
          if (err.message === 'Missing credentials') {
            console.log("No Auth0 credentials, skipping API creation");
            done();
            return;
          }
          if (err.statusCode !== 409) {
            console.log(err);
          }
          done();
        });

    });

    // Create a client for the resource server
    // ***************************************
    // Create client in Auth0
    // Get client ID from auth0
    // Add auth0 client ID to the limited user plan / unlimited user plan
}
