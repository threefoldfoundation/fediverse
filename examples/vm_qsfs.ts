import { HTTPMessageBusClient } from "ts-rmb-http-client";
import { BackendStorageType, GridClient, KeypairType, NetworkEnv, FilterOptions, MachinesModel, QSFSZDBSModel  } from "grid3_client";
import {inspect} from "util";

const network = "dev";
const mnemonic = `ADD MNEMONICS HERE`;
const rmb_proxy = true;
const storeSecret = `secret`;
const ssh_key = `ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCeq1MFCQOv3OCLO1HxdQl8V0CxAwt5AzdsNOL91wmHiG9ocgnq2yipv7qz+uCS0AdyOSzB9umyLcOZl2apnuyzSOd+2k6Cj9ipkgVx4nx4q5W1xt4MWIwKPfbfBA9gDMVpaGYpT6ZEv2ykFPnjG0obXzIjAaOsRthawuEF8bPZku1yi83SDtpU7I0pLOl3oifuwPpXTAVkK6GabSfbCJQWBDSYXXM20eRcAhIMmt79zo78FNItHmWpfPxPTWlYW02f7vVxTN/LUeRFoaNXXY+cuPxmcmXp912kW0vhK9IvWXqGAEuSycUOwync/yj+8f7dRU7upFGqd6bXUh67iMl7 ahmed@ahmedheaven`;
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
    const qsfs_name = "nov82022";
    const machines_name = "nov82022";

    const vmQueryOptions: FilterOptions = {
        cru: 2,
        mru: 2, // GB
        sru: 10,
        farmId: 1,
    };

    const qsfsQueryOptions: FilterOptions = {
        hru: 40,
        farmId: 1,
    };

    const qsfsNodes = [];

    const allNodes = await grid3.capacity.filterNodes(qsfsQueryOptions);
    if (allNodes.length >= 2) {
        // deploy 2 qsfs on each node.
        qsfsNodes.push(+allNodes[0].nodeId, +allNodes[1].nodeId, +allNodes[0].nodeId, +allNodes[1].nodeId);
    } else {
        throw Error("Couldn't find nodes for qsfs");
    }

    const vmNode = +(await grid3.capacity.filterNodes(vmQueryOptions))[0].nodeId;

    const qsfs: QSFSZDBSModel = {
        name: qsfs_name,
        count: 8,
        node_ids: qsfsNodes,
        password: "mypassword",
        disk_size: 10,
        description: "my qsfs test",
        metadata: "",
    };
    // QSFSZDBSModel is a meta model 
    // if you want to create each zdb by hand  https://library.threefold.me/info/manual/#/manual3_iac/grid3_javascript/manual__grid3_javascript_zdb
    // https://github.com/threefoldtech/grid3_client_ts/blob/development/scripts/zdb.ts
    // it will be something like

    // create zdb object
    //   const zdb = new ZDBModel();
    //   zdb.name = "hamada";
    //   zdb.node_id = +(await grid3.capacity.filterNodes(zdbQueryOptions))[0].nodeId;
    //   zdb.mode = ZdbModes.user;
    //   zdb.disk_size = 9;
    //   zdb.publicNamespace = false;
    //   zdb.password = "testzdb";
  
    //   // create zdbs object
    //   const zdbs = new ZDBSModel();
    //   zdbs.name = "tttzdbs";
    //   zdbs.zdbs = [zdb];
    //   zdbs.metadata = '{"test": "test"}';
  
    //   // deploy zdb
    //   const res = await grid3.zdbs.deploy(zdbs);
    //   log(res);
  
    //   // get the deployment
    //   const l = await grid3.zdbs.getObj(zdbs.name);
    //   log(l);




    const vms: MachinesModel = {
        name: machines_name,
        network: {
            name: "nov82022net",
            ip_range: "10.201.0.0/16",
        },
        machines: [
            {
                name: "nov82022m",
                node_id: vmNode,
                disks: [
                    {
                        name: "wed2710d1",
                        size: 10,
                        mountpoint: "/mydisk",
                    },
                ],
                qsfs_disks: [
                    {
                        qsfs_zdbs_name: qsfs_name,
                        name: "nov82022d",
                        minimal_shards: 2,
                        expected_shards: 4,
                        encryption_key: "secret",
                        prefix: "secret",
                        cache: 1,
                        mountpoint: "/nov82022d",
                    },
                ],
                public_ip: false,
                public_ip6: false,
                planetary: true,
                cpu: 1,
                memory: 1024 * 2,
                rootfs_size: 0,
                flist: "https://hub.grid.tf/tf-official-apps/base:latest.flist",
                entrypoint: "/sbin/zinit init",
                env: {
                    SSH_KEY: config.ssh_key,
                },
            },
        ],
        metadata: "{'testVMs': true}",
        description: "test deploying VMs via ts grid3 client",
    };

    async function cancel(grid3: GridClient) {
        // delete
        const d = await grid3.machines.delete({ name: machines_name });
        console.log(d);
        const r = await grid3.qsfs_zdbs.delete({ name: qsfs_name });
        console.log(r);
    }
    //deploy qsfs
    const res = await grid3.qsfs_zdbs.deploy(qsfs);
    console.log(">>>>>>>>>>>>>>>QSFS backend has been created<<<<<<<<<<<<<<<");
    console.log(res);

    const vm_res = await grid3.machines.deploy(vms);
    console.log(">>>>>>>>>>>>>>>vm has been created<<<<<<<<<<<<<<<");
    console.log(vm_res);

    // get the deployment
    const l = await grid3.machines.getObj(vms.name);
    console.log(">>>>>>>>>>>>>>>Deployment result<<<<<<<<<<<<<<<");
    console.log(l);

    await cancel(grid3);  // comment out this line if you want to keep the deployment.

    await grid3.disconnect();
}

// nov82022m:/nov82022d# cd
// nov82022m:~# ls /
// bin        etc        lib        mnt        nov82022d  proc       run        srv        tmp        var
// dev        home       media      mydisk     opt        root       sbin       sys        usr
// nov82022m:~# cd /nov82022d/
// nov82022m:/nov82022d# ls
// nov82022m:/nov82022d# df -h
// Filesystem                Size      Used Available Use% Mounted on
// dev                     983.7M         0    983.7M   0% /dev
// run                     989.5M      8.0K    989.4M   0% /run
// tmpfs                   989.5M         0    989.5M   0% /dev/shm
// /dev/root               476.9G    357.8G    117.2G  75% /
// /dev/vda                 10.0G      3.8M      8.0G   0% /mydisk
// 5913120nov82022d         10.0G      1.0K     10.0G   0% /nov82022d


main()