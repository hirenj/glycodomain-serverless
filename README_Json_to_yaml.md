# Conversion of JSON stacks to YAML stacks

# We need to get the existing stack into the correct format

```
cat glycodomain.template > source_template.json
cat source_template.json | cfn-flip --long > target_template.yaml
cat target_template.yaml | cfn-flip -c -n > target_template_short.yaml
```

We will now have the existing stack definition in the short format.

Apply the CloudFormation updates using the `target_template.yaml` and then `target_template_short.yaml`


## Policies to inline
```
ReadConfig
StartExecutionStatePostProcess
WriteSplitQueue
PublishSplitQueueTopic
StartExecutionStateSplitQueue
WriteSession
ReadSession
ReadRDatasets
RunSerialiseDatasetBuild
```
