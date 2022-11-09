

## QSFS Manual setup on the VM.

- The following steps can be followed to set up a qsfs instance on a fresh ubuntu instance. you can deploy one using [this](/examples/vm.ts) example script.


### Prerequisites

- Install the fuse kernel module (`apt-get update && apt-get install fuse3`)
- Install the individual components, by downloading the latest release from the respective release pages:
  - 0-db-fs: https://github.com/threefoldtech/0-db-fs/releases
  - 0-db: https://github.com/threefoldtech/0-db/releases, if multiple binaries are available in the assets, choose the one ending in `static`
  - 0-stor: https://github.com/threefoldtech/0-stor_v2/releases, if multiple binaries are available in the assets, choose the one ending in `musl`
- You can download all of these binaries in your VM using `wget <binary_download_link>`
- For ease of use while following this tutorial rename each of the binaries after downloading to `0-db`,`0-db-fs`,`zstor` using `mv <old_binary_name> 0-db`  
- Make sure all binaries are executable (`chmod +x $binary`)
- Copy the downloaded binaries to `/tmp`.

### Setup and run 0-stor

We will run 7 0-db instances as backends for 0-stor. 4 are used for the metadata, 3 are used for the actual data. The metadata always consists of 4 nodes. The data backends can be increased. You can choose to either run 7 separate 0-db processes, or a single process with 7 namespaces. For the purpose of this setup, we will start 7 separate processes, as such:

```
/tmp/0-db --background --mode user --port 9990 --data /tmp/zdb-meta/zdb0/data --index /tmp/zdb-meta/zdb0/index
/tmp/0-db --background --mode user --port 9991 --data /tmp/zdb-meta/zdb1/data --index /tmp/zdb-meta/zdb1/index
/tmp/0-db --background --mode user --port 9992 --data /tmp/zdb-meta/zdb2/data --index /tmp/zdb-meta/zdb2/index
/tmp/0-db --background --mode user --port 9993 --data /tmp/zdb-meta/zdb3/data --index /tmp/zdb-meta/zdb3/index

/tmp/0-db --background --mode seq --port 9980 --data /tmp/zdb-data/zdb0/data --index /tmp/zdb-data/zdb0/index
/tmp/0-db --background --mode seq --port 9981 --data /tmp/zdb-data/zdb1/data --index /tmp/zdb-data/zdb1/index
/tmp/0-db --background --mode seq --port 9982 --data /tmp/zdb-data/zdb2/data --index /tmp/zdb-data/zdb2/index
```
Now that the data storage is running, we can create the config file for 0-stor. The (minimal) config for this example setup will look as follows:

```toml
minimal_shards = 2
expected_shards = 3
redundant_groups = 0
redundant_nodes = 0
socket = "/tmp/zstor.sock"
prometheus_port = 9100
zdb_data_dir_path = "/tmp/zdbfs/data/zdbfs-data"
max_zdb_data_dir_size = 25600

[encryption]
algorithm = "AES"
key = "000001200000000001000300000004000a000f00b00000000000000000000000"

[compression]
algorithm = "snappy"

[meta]
type = "zdb"

[meta.config]
prefix = "someprefix"

[meta.config.encryption]
algorithm = "AES"
key = "0101010101010101010101010101010101010101010101010101010101010101"

[[meta.config.backends]]
address = "[::1]:9990"

[[meta.config.backends]]
address = "[::1]:9991"

[[meta.config.backends]]
address = "[::1]:9992"

[[meta.config.backends]]
address = "[::1]:9993"

[[groups]]
[[groups.backends]]
address = "[::1]:9980"

[[groups.backends]]
address = "[::1]:9981"

[[groups.backends]]
address = "[::1]:9982"
```
- This guide assumes the config file is saved as `/tmp/zstor_config.toml`.
- Now `zstor` can be started. Assuming the downloaded binary was saved as `/tmp/zstor`:
- `/tmp/zstor -c /tmp/zstor_config.toml monitor`. If you don't want the process to block your terminal, you can start it in the background: `nohup /tmp/zstor -c /tmp/zstor_config.toml monitor &`.
- Create this directory`/tmp/zdbfs/data/zdbfs-data` to save the zdbfs data in.

### Setup and run 0-db

First we will get the hook script. The hook script can be found in the [quantum_storage](https://github.com/threefoldtech/quantum-storage) repo on github. A slightly modified version is found here:

```bash
#!/usr/bin/env bash
set -ex

action="$1"
instance="$2"
zstorconf="/tmp/zstor_config.toml"
zstorbin="/tmp/zstor"

if [ "$action" == "ready" ]; then
    ${zstorbin} -c ${zstorconf} test
    exit $?
fi

if [ "$action" == "jump-index" ]; then
    namespace=$(basename $(dirname $3))
    if [ "${namespace}" == "zdbfs-temp" ]; then
        # skipping temporary namespace
        exit 0
    fi

    tmpdir=$(mktemp -p /tmp -d zdb.hook.XXXXXXXX.tmp)
    dirbase=$(dirname $3)

    # upload dirty index files
    for dirty in $5; do
        file=$(printf "i%d" $dirty)
        cp ${dirbase}/${file} ${tmpdir}/
    done

    ${zstorbin} -c ${zstorconf} store -s -d -f ${tmpdir} -k ${dirbase} &

    exit 0
fi

if [ "$action" == "jump-data" ]; then
    namespace=$(basename $(dirname $3))
    if [ "${namespace}" == "zdbfs-temp" ]; then
        # skipping temporary namespace
        exit 0
    fi

    # backup data file
    ${zstorbin} -c ${zstorconf} store -s --file "$3"

    exit 0
fi

if [ "$action" == "missing-data" ]; then
    # restore missing data file
    ${zstorbin} -c ${zstorconf} retrieve --file "$3"
    exit $?
fi

# unknown action
exit 1
```
- This guide assumes the file is saved as `/tmp/zdbfs/zdb-hook.sh`. Make sure the file is executable, i.e. `chmod +x /tmp/zdbfs/zdb-hook.sh`

The local 0-db which is used by 0-db-fs can be started as follows:
```
/tmp/0-db \
    --index /tmp/zdbfs/index \
    --data /tmp/zdbfs/data \
    --datasize 67108864 \
    --mode seq \
    --hook /tmp/zdbfs/zdb-hook.sh \
    --background
```

### Setup and run 0-db-fs

Finally, we will start 0-db-fs. This guides opts to mount the fuse filesystem in `/mnt`. Again, assuming the 0-db-fs binary was saved as `/tmp/0-db-fs`:

```
/tmp/0-db-fs /mnt -o autons -o background
```
You should now have the qsfs filesystem mounted at `/mnt`. As you write data, it will save it in the local 0-db, and it's data containers will be periodically encoded and uploaded to the backend data storage 0-db's.

### Monitoring, alerting and statistics

0-stor collects metrics about the system. It can be configured with a 0-db-fs mountpoint, which will trigger 0-stor to collect 0-db-fs statistics, next to some 0-db statistics which are always collected. If the prometheus_port config option is set, 0-stor will serve metrics on this port for scraping by prometheus.

If you followed the same configuration in `zstor_config.toml` as mentioned above you will be able to access these metrics by executing `curl localhost:9100/metrics`