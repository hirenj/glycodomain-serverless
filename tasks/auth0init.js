'use strict';

var aws = require('aws-sdk');
var async = require('async');


module.exports = function (grunt) {

    let AuthenticationClient = require('auth0').AuthenticationClient;
    let ManagementClient = require('auth0').ManagementClient;

    let auth0 = new AuthenticationClient({
        domain: '{YOUR_ACCOUNT}.auth0.com',
        clientId: '{CLIENT_ID}',
        clientSecret: '{CLIENT_SECRET}'
    });

    auth0.clientCredentialsGrant({
        audience: 'https://{YOUR_ACCOUNT}.auth0.com/api/v2/',
        scope: '{MANAGEMENT_API_SCOPES}'
    }, function (err, response) {
      if (err) {
      }
      console.log(response.access_token);
    });

    let DESC = 'Creates Auth0 resource server for stack';
    let DEFAULTS = {
        desc: DESC
    };

    grunt.registerMultiTask('register', DEFAULTS.desc, function () {

        let management = new ManagementClient({
          token: '{YOUR_API_V2_TOKEN}',
          domain: '{YOUR_ACCOUNT}.auth0.com'
        });
        let data = {
          "name": "<stage>",
          "identifier": "https://<url>",
          "scopes": [
            "download:all_data",
            "download:subset_data",
            "query"
          ],
          "allow_offline_access": true,
          "skip_consent_for_verifiable_first_party_clients": true
        };

        management.resourceServers.create(data, function (err) {
            if (err) {
                // Handle error.
            }

           // Resource Server created.
        });

        let done = this.async();
        let opts = this.options(DEFAULTS);

    });
}
