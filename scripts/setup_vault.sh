#!/bin/sh

stage="${1:-gator-test}"
credentials_file="$2"
region="us-east-1"
role="CreateChangeSet"
policies="... READ FROM BUILD DUMP .." #Comma separated

vault_path="aws-gator-${stage}"

vault secrets enable -path="$vault_path" aws
vault write "$vault_path/config/lease" lease=15m lease_max=1h
#vault write "$vault_path/config/root" access_key="" secret_key="" region="$region"
vault write "$vault_path/roles/$role" policy_arns=$policies credential_type=iam_user