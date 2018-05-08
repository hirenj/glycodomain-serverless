# glycodomain-serverless

## What to do


### Copying configs to submodule directories
```
grunt update_configs:test
(export AWS_REGION=eu-west-1; grunt update_configs:beta --region=eu-west-1)
(export AWS_REGION=eu-west-1; grunt update_configs:prod --region=eu-west-1)
```

### Deploying
```
grunt deploy:test
(export AWS_REGION=eu-west-1; grunt deploy:beta --region=eu-west-1)
(export AWS_REGION=eu-west-1; grunt deploy:prod --region=eu-west-1)
```
