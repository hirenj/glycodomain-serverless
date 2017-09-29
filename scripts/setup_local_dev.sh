#!/bin/bash

submodules=$(node -e 'Object.keys(require("./package.json").dependencies).map( key => require("./package.json").dependencies[key] ).map(val => console.log(val))' | grep '/' | sed -e 's/.*\///')

lowercase(){
    echo "$1" | sed "y/ABCDEFGHIJKLMNOPQRSTUVWXYZ/abcdefghijklmnopqrstuvwxyz/"
}

OS=`lowercase \`uname -s\``

if [ ! -d '../lambda-helpers' ]; then
	echo "Installing common lambda-helpers"
	git clone git@github.com:hirenj/lambda-helpers.git lambda-helpers
fi

echo "Linking lambda-helpers"
(cd ../lambda-helpers; npm install; npm link; npm link aws-sdk)
(cd ../grunt-aws-lambda; npm install --production; npm link; npm link aws-sdk)


rm -rf node_modules

(cd ..; npm link grunt@0.4.5 --production;)

for module in $submodules; do
	echo "Setting up $module"
	if [ -z "$setup_grunt" ]; then
		npm install grunt@0.4.5 --production
		npm link grunt
		setup_grunt=1
	fi
	if [ ! -d "../$module" ]; then
		echo "Cloning $module"
		git clone git@github.com:hirenj/$module.git $module
	fi
	(
		cd ../$module
		rm -rf node_modules
		needs_helpers=$(grep 'lambda-helpers' package.json)
		if [ ! -z "$needs_helpers" ]; then
			npm link lambda-helpers
		fi
		needs_sdk=$(grep 'aws-sdk' package.json)
		if [ ! -z "$needs_sdk" ]; then
			npm link aws-sdk
		fi
		needs_aws_lambda=$(grep 'grunt-aws-lambda' package.json)
		if [ ! -z "$needs_aws_lambda" ]; then
			npm link grunt
			npm link grunt-aws-lambda
		fi
		echo "Installing with target_platform $OS arch x64"
		npm install --target_platform=$OS --target_arch=x64
		npm link --target_platform=$OS --target_arch=x64
	)
	npm link $module
done

(cd ../lambda-rdatasets; npm link node-rdata; npm link node-tde;)

npm install