import axios from "axios";
import { HTTPMessageBusClient } from "ts-rmb-http-client";
import {
    DiskModel,
    FilterOptions,
    GatewayNameGetModel,
    GatewayNameModel,
    GridClient,
    MachineModel,
    MachinesModel,
    NetworkModel,
    NetworkEnv,
    BackendStorageType,
    KeypairType

} from "grid3_client";
import {inspect} from "util";

enum instanceTypeEnum {
    small = "small",
    large = "large",
}

// params as constants, you must set all those variables before you make any deployment.
const adminUsername = "omda";
const adminPassword = "password";
const adminEmail = "omda@gmail.com";
const instanceName = "mastodon";
const location = "Belgium";
const instanceType: string = instanceTypeEnum.small;

// Config
const sshKey: string  = "ADD SSH-KEY HERE";
const network = NetworkEnv.dev; // dev, qa, test, or main
const mnemonic = `ADD MNEMONICS HERE`;
const rmb_proxy = true;
const storeSecret = `secret`;

let config = {
        network: network,
        mnemonic: mnemonic,
        rmb_proxy: rmb_proxy,
        storeSecret: storeSecret,
        ssh_key: sshKey,
};

async function mastodonProvider(playGround: PlayGround) {
    // init and deploy machine for mastodon with domain name.
    return await playGround.deploy();
    // uncomment the clean method to remove the deployments you have deployed.
    // return await playGround.clean();
}

function log(message: Object) {
    console.log(inspect(message, { showHidden: false, depth: null, colors: true }));
}

async function getClient(): Promise<GridClient> {
    let rmb = new HTTPMessageBusClient(0, "", "", "");

    const gridClient = new GridClient(
        config.network,
        config.mnemonic,
        config.storeSecret,
        rmb,
        "",
        BackendStorageType.auto,
        KeypairType.sr25519,
    );
    await gridClient.connect();
    return gridClient;
}

class PlayGround {
    // Class PlayGround has all the required grid functions.
    private customResponse = new CustomResponse();

    private async getDomainName(grid3: GridClient) {
        // Check if the domain name is exist.
        const gw: GatewayNameGetModel = new GatewayNameGetModel();
        gw.name = instanceName;
        const domain = await grid3.gateway.get_name(gw);
        if (domain.length > 0) {
            return true;
        }
        return false;
    }

    private getInstanceType() {
        // Calculate resources based on type => small or large.
        let memory = 0;
        let diskSize = 0;
        if (instanceType == instanceTypeEnum.small) {
            memory = 1024 * 2;
            diskSize = 15;
        } else if (instanceType == instanceTypeEnum.large) {
            memory = 1024 * 4;
            diskSize = 30;
        } else {
            this.customResponse.error("💣 Unknown instance type, try to choice from [small, larg].");
        }
        return { memory: memory, diskSize: diskSize };
    }

    private prepareNetwork(): NetworkModel {
        // create network Object
        const network: NetworkModel = new NetworkModel();
        network.name = `${instanceName}test`;
        network.ip_range = "10.249.0.0/16";
        return network;
    }

    private prepareDisk(mountPoiunt: string, size: number): DiskModel {
        // create disk Object
        const disk: DiskModel = new DiskModel();
        disk.name = `${instanceName}Disk`;
        disk.size = size;
        disk.mountpoint = mountPoiunt;
        return disk;
    }

    private prepareVM(nodeID: number, disks: DiskModel[]): MachineModel {
        // create vm node Object
        const vm: MachineModel = new MachineModel();
        vm.name = `${instanceName}VM`;
        vm.node_id = nodeID;
        vm.disks = disks;
        vm.public_ip = false;
        vm.planetary = true;
        vm.cpu = 1;
        vm.memory = this.getInstanceType().memory;
        vm.rootfs_size = 0;
        vm.flist = "https://hub.grid.tf/tf-official-apps/mastodon-latest.flist";

        vm.entrypoint = "/sbin/zinit init";
        vm.env = {
            SSH_KEY: config.ssh_key,
            LOCAL_DOMAIN: `${instanceName}.gent01.dev.grid.tf`,
            SUPERUSER_USERNAME: adminUsername,
            SUPERUSER_EMAIL: adminEmail,
            SUPERUSER_PASSWORD: adminPassword,
        };
        return vm;
    }

    private prepareVMS(network: NetworkModel, machines: MachineModel[]): MachinesModel {
        // create VMs Object
        const vms = new MachinesModel();
        vms.name = `${instanceName}VMS`;
        vms.network = network;
        vms.machines = machines;
        vms.metadata = "{'testVMs': true}";
        vms.description = "test deploying VMs via ts grid3 client";
        return vms;
    }

    private prepareGW(gwNodeID: number, planetary: string | unknown): GatewayNameModel {
        const gw = new GatewayNameModel();
        gw.name = instanceName;
        gw.node_id = gwNodeID;
        gw.tls_passthrough = false;
        gw.backends = [`http://[${planetary}]:3000`];
        return gw;
    }

    private async deleteVM(grid3: GridClient) {
        // delete the deployed vm with the instance name.
        const d = await grid3.machines.delete({ name: `${instanceName}VMS` });
        log(d);
    }

    private async deleteName(grid3: GridClient) {
        // delete the deployed vm with the instance name.
        const d = await grid3.gateway.delete_name({ name: instanceName });
        log(d);
    }

    public async deploy() {
        // A helper method to deploy [machine, network, domain].
        const vmQueryOptions: FilterOptions = {
            country: location,
            mru: this.getInstanceType().memory / 1024,
            sru: playGround.getInstanceType().diskSize,
        };

        const gatewayQueryOptions: FilterOptions = {
            gateway: true,
            farmId: 1,
        };

        const grid3: GridClient = await getClient();
        await grid3.connect();

        const domainFound = await this.getDomainName(grid3);
        if (domainFound) {
            customResponse.error("💣 This domain already taken!");
            await grid3.disconnect();
            return;
        }

        const vmNodeID: number = +(await grid3.capacity.filterNodes(vmQueryOptions))[0].nodeId;
        const gwNodeID: number = +(await grid3.capacity.filterNodes(gatewayQueryOptions))[0].nodeId;
        const network: NetworkModel = this.prepareNetwork();

        const disk: DiskModel = this.prepareDisk("/var/lib/docker", this.getInstanceType().diskSize); // mount, size

        const machine: MachineModel = this.prepareVM(vmNodeID, [disk]); // nodeID, [disks]

        const machines: MachinesModel = this.prepareVMS(network, [machine]); // network, [machine]

        await grid3.machines.deploy(machines);
        const VMObj = await grid3.machines.getObj(machines.name);

        const gatewayName: GatewayNameModel = this.prepareGW(gwNodeID, VMObj[0]["planetary"]); // NodeID, domain name

        await grid3.gateway.deploy_name(gatewayName);

        const domainObj = await grid3.gateway.getObj(gatewayName.name);
        await grid3.disconnect();

        return await this.delay(VMObj, domainObj, 1, 0);
    }

    public async delay(VMObj: any, domainObj: any, stage: number, count: number) {
        // This method was implemented just for wanting to track the site until becomes alive!
        if (count == 4) {
            stage += 1;
            count = 1;
        }
        const siteUrl = `https://${domainObj[0]["domain"]}/explore`;
        try {
            await axios.get(siteUrl);
            log(`stage : ${stage}| 🎉 We are alive!!`);
            return customResponse.success(VMObj, domainObj);
        } catch (e) {
            return customResponse.delay(VMObj, domainObj, stage, count);
        }
    }

    public async clean() {
        // Clean a helper method, you can use it when you wanna delete everything you deployed.
        const grid3: GridClient = await getClient();
        await grid3.connect();
        await this.deleteName(grid3);
        await this.deleteVM(grid3);
        await grid3.disconnect();
        return customResponse.cleaned();
    }
}

class CustomResponse {
    // Custom response class to log the response in terminal with custom pattern.
    public success(VMObj: any, nameObj: any) {
        const simpleResponse = {
            planetaryNetwork: VMObj[0]["planetary"],
            flist: VMObj[0]["flist"],
            nodeId: VMObj[0]["nodeId"],
            name: VMObj[0]["name"],
            siteUrl: `https://${nameObj[0]["domain"]}`,
            status: "🎉 Deployed!",
            credentials: {
                email: adminEmail,
                password: adminPassword,
            },
        };
        log("✔️ ->-> Success response <-<- ✔️");
        log(simpleResponse);
        log("Don't forget to change your password on site.");
        log("<<<<<<<<<<<<<<<<<<<>>>>>>>>>>>>>>>>>>>>");
        return;
    }

    public error(messgae: string) {
        log("❌ ->-> Error found in response <-<- ❌");
        log(messgae);
        return;
    }

    public cleaned() {
        log("✔️ ->-> Cleaned Successfully <-<- ✔️");
    }

    public delay(VMObj: any, domainObj: any, stage: number, count: number) {
        // Method wait on it implemented to use as a logger to watch the site until becomes alive.
        const playGround = new PlayGround();
        const messages: string[] = [
            "🧐 Processing!",
            "🍩 It may take a few minutes, take a rest!",
            "🌍 Still under deploy stage!",
            "📣 We are so close!",
            "💫 Almost done!",
        ];
        const message: string = messages[Math.floor(Math.random() * messages.length)];
        // log(`stage : ${stage}| ${message}`)
        setTimeout(function () {
            log(`stage : ${stage}| ${message}`);
            count += 1;
            return playGround.delay(VMObj, domainObj, stage, count);
        }, 10000);
    }
}

const playGround = new PlayGround();
const customResponse = new CustomResponse();

mastodonProvider(playGround);
