# Day 03 — NSG + ASG Build Script (Azure CLI)

Provisions the network, security groups, and VMs for the three-tier layout,
then installs the service on each tier.

## Variables

```bash
RG="rg-day03-nsg"
LOC="eastus"
VNET="vnet-devops"
WEB_SUBNET="web-subnet"
APP_SUBNET="app-subnet"
```

## Resource Group

```bash
az group create \
  --name $RG \
  --location $LOC
```

## Virtual Network

Create the VNet (the Web subnet is created inline as the first subnet):

```bash
az network vnet create \
  --resource-group $RG \
  --name $VNET \
  --address-prefix 10.10.0.0/16 \
  --subnet-name $WEB_SUBNET \
  --subnet-prefix 10.10.1.0/24
```

Create the App subnet:

```bash
az network vnet subnet create \
  --resource-group $RG \
  --vnet-name $VNET \
  --name $APP_SUBNET \
  --address-prefix 10.10.2.0/24
```

## Application Security Groups

Create the Web ASG:

```bash
az network asg create \
  --resource-group $RG \
  --name asg-web \
  --location $LOC
```

Create the App ASG:

```bash
az network asg create \
  --resource-group $RG \
  --name asg-app \
  --location $LOC
```

## Network Security Groups

Create the Web NSG:

```bash
az network nsg create \
  --resource-group $RG \
  --name nsg-web \
  --location $LOC
```

Create the App NSG:

```bash
az network nsg create \
  --resource-group $RG \
  --name nsg-app \
  --location $LOC
```

## Web NSG Rules

### Rule 1 — Internet → Web HTTP/HTTPS

The roadmap uses priority 100 and allows TCP 80/443 to the Web ASG.

```bash
az network nsg rule create \
  --resource-group $RG \
  --nsg-name nsg-web \
  --name Allow-HTTP-Internet \
  --priority 100 \
  --direction Inbound \
  --access Allow \
  --protocol Tcp \
  --source-address-prefixes Internet \
  --source-port-ranges '*' \
  --destination-asg asg-web \
  --destination-port-ranges 80 443
```

### Rule 2 — SSH Only From Your IP

First find your public IP:

```bash
MYIP=$(curl -s https://api.ipify.org)
echo $MYIP
```

Then:

```bash
az network nsg rule create \
  --resource-group $RG \
  --nsg-name nsg-web \
  --name Allow-SSH-MyIP \
  --priority 110 \
  --direction Inbound \
  --access Allow \
  --protocol Tcp \
  --source-address-prefixes "$MYIP/32" \
  --source-port-ranges '*' \
  --destination-asg asg-web \
  --destination-port-ranges 22
```

The important concept is:

```text
MYIP/32  -> Web :22  -> ALLOW
```

not:

```text
Any     -> Web :22  -> ALLOW
```

That's least privilege.

## App NSG Rules

### Rule 1 — Web ASG → App ASG :8080

Priority 100.

```bash
az network nsg rule create \
  --resource-group $RG \
  --nsg-name nsg-app \
  --name Allow-Web-To-App-8080 \
  --priority 100 \
  --direction Inbound \
  --access Allow \
  --protocol Tcp \
  --source-asg asg-web \
  --source-port-ranges '*' \
  --destination-asg asg-app \
  --destination-port-ranges 8080
```

The traffic path becomes:

```text
VM-WEB
  |
  |  TCP 8080
  v
asg-app
  |
  v
VM-APP
```

### Rule 2 — Explicit Internet Deny

The explicit Internet deny from the roadmap:

```bash
az network nsg rule create \
  --resource-group $RG \
  --nsg-name nsg-app \
  --name Deny-Internet-Inbound \
  --priority 4000 \
  --direction Inbound \
  --access Deny \
  --protocol '*' \
  --source-address-prefixes Internet \
  --source-port-ranges '*' \
  --destination-address-prefixes '*' \
  --destination-port-ranges '*'
```

### Why priority 4000?

NSG rules are evaluated lowest-number-wins, and the built-in `DenyAllInbound`
rule sits at priority 65500. A custom rule only takes effect if it is more
specific (lower number) than that default, so an explicit deny needs a number
below 65500 while still ranking after the allow rules (100). 4000 leaves a wide
gap for future allow rules to be slotted in ahead of the blanket deny.

## Associate NSGs With Subnets

Web:

```bash
az network vnet subnet update \
  --resource-group $RG \
  --vnet-name $VNET \
  --name $WEB_SUBNET \
  --network-security-group nsg-web
```

App:

```bash
az network vnet subnet update \
  --resource-group $RG \
  --vnet-name $VNET \
  --name $APP_SUBNET \
  --network-security-group nsg-app
```

Now:

```text
              VNet
               |
        +------+------+
        |             |
        v             v
  Web subnet       App subnet
        |             |
      nsg-web       nsg-app
        |             |
      asg-web       asg-app
```

An NSG attached to a subnet applies to every NIC in that subnet — including
NICs that have no ASG membership at all.

## Create the VMs

The roadmap specifies:

| VM | Image | Size | Public IP |
|---|---|---|---|
| Web | Ubuntu 22.04 | Standard_B1s | Standard |
| App | Ubuntu 22.04 | Standard_B1s | none |

Create Web:

```bash
az vm create \
  --resource-group $RG \
  --name vm-web \
  --image Ubuntu2204 \
  --size Standard_B1s \
  --vnet-name $VNET \
  --subnet $WEB_SUBNET \
  --public-ip-sku Standard \
  --admin-username azureuser \
  --generate-ssh-keys
```

Create App:

```bash
az vm create \
  --resource-group $RG \
  --name vm-app \
  --image Ubuntu2204 \
  --size Standard_B1s \
  --vnet-name $VNET \
  --subnet $APP_SUBNET \
  --public-ip-address ""
```

> The exact CLI behaviour for VM creation can vary with Azure CLI / image
> availability. If Azure rejects a parameter, capture the error rather than
> changing the architecture.

## Attach NICs to ASGs

First find the NIC names:

```bash
az vm show \
  --resource-group $RG \
  --name vm-web \
  --show-details \
  --query "networkProfile.networkInterfaces[0].id" \
  --output tsv
```

And:

```bash
az vm show \
  --resource-group $RG \
  --name vm-app \
  --show-details \
  --query "networkProfile.networkInterfaces[0].id" \
  --output tsv
```

Then obtain the NIC names/IDs and associate them with their ASGs.

Conceptually:

```text
vm-web NIC
    |
    +-- asg-web
```

```text
vm-app NIC
    |
    +-- asg-app
```

This is the key connection between the VM and the ASG: an ASG rule matches by
NIC membership, so a rule targeting `asg-web` only ever sees traffic from
NICs that were explicitly added to `asg-web`.

## Install the Services

### Web VM

SSH into Web:

```bash
ssh azureuser@<WEB_PUBLIC_IP>
```

Install Nginx:

```bash
sudo apt update
sudo apt install nginx -y
```

Verify:

```bash
curl http://localhost
```

You should get an HTTP response.

Architecture:

```text
Internet
   |
   |  :80
   v
 NSG
   |
   v
 Nginx
```

### App VM

From the Web VM, connect to the App VM's private IP.

Find App's private IP:

```bash
az vm show \
  --resource-group $RG \
  --name vm-app \
  --show-details \
  --query privateIps \
  --output tsv
```

Then from Web:

```bash
ssh azureuser@<APP_PRIVATE_IP>
```

Install Python if needed:

```bash
sudo apt update
sudo apt install python3 -y
```

Create a simple server:

```bash
python3 -m http.server 8080 --bind 0.0.0.0
```

Now App is listening on TCP 8080, reachable only from the Web tier because
`nsg-app` allows `:8080` from `asg-web` alone.
