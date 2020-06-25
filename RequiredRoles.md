# Required roles for updating and installing glycodomain software


## Software updates
### Commands that are run
```
grunt deploy_stacks
deploy individual modules
``` 

https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_actions-resources-contextkeys.html

Vault config:

```
vault secrets enable aws

vault write aws/config/root \
		access_key=SOMEACCESSKEY \
		secret_key=SOMESECRETKEY \
		region=us-east-1

vault write aws/config/lease lease=30m lease_max=1h

vault write aws/roles/MYROLE \
    policy_arns=ADDINPOLICYARNS,SEPARATEDBYCOMMA,HERE\
    credential_type=iam_user

```



* lambda deployment
* getFunctionConfiguration
* updateFunctionConfiguration
* Upload code?

* refresh_all DynamoDb query data, listExecutions, StartExecutionStatePostProcess