# glycodomain-serverless

```
{
   "AWSTemplateFormatVersion": "2010-09-09",
   "Resources": {
       "ChildStack01": {
           "Type": "AWS::CloudFormation::Stack",
           "Properties": {
               "TemplateURL": "https://s3.amazonaws.com/cloudformation-templates-us-east-1/VPC.template",
               "TimeoutInMinutes": "60"
           }
       },
       "ChildStack02": {
           "Type": "AWS::CloudFormation::Stack",
           "Properties": {
               "TemplateURL": "https://s3.amazonaws.com/cloudformation-templates-us-east-1/Subnet.template",
               "Parameters": {
                  "VpcId" : { "Fn::GetAtt" : [ "ChildStack01", "Outputs.VpcID" ] },
               },
               "TimeoutInMinutes": "60"
           }
       }
   },
   "Outputs": {
       "StackRef": {
           "Value": { "Ref": "ChildStack02" }
       },
       "OutputFromNestedStack": {
           "Value": { "Fn::GetAtt": [ "ChildStack02", "Outputs.SubnetID" ]}
       }
   }
}
```