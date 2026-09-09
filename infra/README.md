# Infrastructure

Terraform for the Modex Apply platform. This is a skeleton: the module
boundaries and the security-relevant configuration are here, but no environment
has been applied, because the cloud region and the messaging and payment
providers are still open decisions (issue #1 §7, decision 6) and those decisions
determine what a launch market's data rules permit.

```
main.tf         Providers and remote state
variables.tf    Inputs, with the launch-market ones called out
database.tf     PostgreSQL, including the least-privilege application role
storage.tf      S3-compatible object storage for documents
network.tf      VPC, subnets, security groups
```
