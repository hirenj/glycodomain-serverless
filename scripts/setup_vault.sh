#!/bin/bash

application="${1:-gator-test}"
role="${2:-CreateChangeSet}"
AWS_REGION="${AWS_REGION:-us-east-1}"
credentials_file="$4"
policies="... READ FROM BUILD DUMP .." #Comma separated

vault_path="aws-${application}"

engine_exists=$(vault secrets list | grep "$vault_path")

if [[ "$engine_exists" == "" ]]; then
	vault secrets enable -path="$vault_path" aws
	vault write "$vault_path/config/lease" lease=10m lease_max=1h
fi

if [[ "$credentials_file" != "" ]]; then

	while IFS="," read -r access_key_id secret_access_key
	do
	ACCESS_KEY_ID="$access_key_id"
	secret_access_key="${secret_access_key%$'\n'}"
	secret_access_key="${secret_access_key%$'\r'}"
	SECRET_ACCESS_KEY="$secret_access_key"
	done < "$credentials_file"

	vault write "$vault_path/config/root" access_key="$ACCESS_KEY_ID" secret_key="$SECRET_ACCESS_KEY" region="$AWS_REGION"
fi

#vault write "$vault_path/roles/$role" policy_arns=$policies credential_type=iam_user

# Test reading the config

echo "Testing reading an Access key from the vault at $vault_path for role $role"
vault read -format=json -field=access_key "${vault_path}/creds/${role}"