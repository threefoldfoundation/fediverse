import { HTTPMessageBusClient } from "ts-rmb-http-client";
import { BackendStorageType, GridClient, KeypairType, NetworkEnv, FilterOptions, MachinesModel, QSFSZDBSModel  } from "grid3_client";
import {inspect} from "util";

const network = "dev"; // dev, qa, test, or main
const mnemonic = "ADD MNEMONICS HERE";
const rmb_proxy = true;
const storeSecret = "secret";
const ssh_key = "ADD SSH KEY HERE";
let config = {
        network: NetworkEnv.dev,
        mnemonic: mnemonic,
        rmb_proxy: rmb_proxy,
        storeSecret: storeSecret,
        ssh_key: ssh_key,
};

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

async function main() {
    let grid3 = await getClient();
    const machines_name = "nov92022";

    const vmQueryOptions: FilterOptions = {
        cru: 2,
        mru: 2, // GB
        sru: 10,
        farmId: 1,
    };

    const vmNode = +(await grid3.capacity.filterNodes(vmQueryOptions))[0].nodeId;

    const vms: MachinesModel = {
        name: machines_name,
        network: {
            name: "nov92022net",
            ip_range: "10.201.0.0/16",
        },
        machines: [
            {
                name: "nov82022m",
                node_id: vmNode,
                public_ip: false,
                public_ip6: false,
                planetary: true,
                disks:[],
                cpu: 1,
                memory: 1024 * 2,
                rootfs_size: 0,
                flist: "https://hub.grid.tf/tf-official-apps/threefoldtech-ubuntu-22.04.flist",
                entrypoint: "/sbin/zinit init",
                env: {
                    SSH_KEY: config.ssh_key,
                },
            },
        ],
        metadata: "{'testVMs': true}",
        description: "test deploying VMs via ts grid3 client",
    };

    // deploy
    const vm_res = await grid3.machines.deploy(vms);
    console.log(vm_res);

    // get the deployment
    const l = await grid3.machines.getObj(vms.name);
    console.log(l);
    
    // // delete
    // const d = await grid3.machines.delete({ name: machines_name });
    // console.log(d);

    await grid3.disconnect();
}

main();