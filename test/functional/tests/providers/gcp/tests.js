/*
 * Copyright 2019. F5 Networks, Inc. See End User License Agreement ("EULA") for
 * license terms. Notwithstanding anything to the contrary in the EULA, Licensee
 * may copy and modify this software product for its internal business purposes.
 * Further, Licensee may upload, publish and distribute the modified version of
 * the software product on devcentral.f5.com.
 */

'use strict';

const assert = require('assert');

/* eslint-disable import/no-extraneous-dependencies */
const { google } = require('googleapis');
const fs = require('fs');

const compute = google.compute('v1');

const constants = require('../../../../constants.js');
const utils = require('../../../../shared/util.js');
const funcUtils = require('../../shared/util.js');

const RETRIES = constants.RETRIES;

const duts = funcUtils.getHostInfo();
const dutPrimary = duts.filter(dut => dut.primary)[0];
const dutSecondary = duts.filter(dut => !dut.primary)[0];

const deploymentInfo = funcUtils.getEnvironmentInfo();
const exampleDeclaration = require('../../shared/exampleDeclaration.json');

const declaration = funcUtils.getDeploymentDeclaration(exampleDeclaration);
const networkInterfaceTagKey = Object.keys(declaration.failoverAddresses.scopingTags)[0];
const networkInterfaceTagValue = declaration.failoverAddresses.scopingTags[networkInterfaceTagKey];
const storageTagKey = Object.keys(declaration.externalStorage.scopingTags)[0];
const storageTagValue = declaration.externalStorage.scopingTags[storageTagKey];


let request = {};

// Helper functions
function configureAuth() {
    // To run this in local environment, make sure to export the environmental variable
    // GOOGLE_CREDENTIALS and CI_PROJECT_DIR
    if (process.env.GOOGLE_CREDENTIALS) {
        const tmpCredsFile = `${process.env.CI_PROJECT_DIR}/gcloud_creds.json`;
        fs.writeFileSync(tmpCredsFile, process.env.GOOGLE_CREDENTIALS);
        process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpCredsFile;
        return google.auth.getClient({
            scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });
    }
    return Promise.reject(new Error('gcloud creds are not provided via env variable titled as GOOGLE_CREDENTIALS'));
}
function checkAliasIPs(hostname, virtualAddresses) {
    return new Promise((resolve, reject) => {
        compute.instances.list(request, (err, response) => {
            if (err) {
                reject(err);
            } else {
                resolve(response);
            }
        });
    })
        .then((data) => {
            const instances = data.data.items || [];
            let match = false;

            instances.forEach((vm) => {
                if (vm.labels) {
                    if (Object.values(vm.labels)
                        .indexOf(networkInterfaceTagValue) !== -1
                        && Object.keys(vm.labels)
                            .indexOf(storageTagKey) !== -1) {
                        if (vm.name.indexOf(hostname) !== -1) {
                            if (virtualAddresses.indexOf(
                                vm.networkInterfaces[0].aliasIpRanges[0].ipCidrRange.split('/')[0]
                            ) !== -1) {
                                match = true;
                            }
                        }
                    }
                }
            });
            if (!match) {
                assert.fail('Matching alias IP not found');
            }
        })
        .catch(err => Promise.reject(err));
}
function checkForwardingRules(hostname) {
    return new Promise((resolve, reject) => {
        compute.forwardingRules.list(request, (err, response) => {
            if (err) {
                reject(err);
            } else {
                resolve(response);
            }
        });
    })
        .then((data) => {
            const fwdRules = data.data.items || [];
            let testFwdRuleFlag = false;

            if (fwdRules) {
                fwdRules.forEach((fwdRule) => {
                    if (fwdRule.name.indexOf(deploymentInfo.deploymentId) !== -1) {
                        testFwdRuleFlag = fwdRule.target.indexOf(
                            `${hostname.split('-')[3]}-${hostname.split('-')[4]}`
                        ) !== -1;
                    }
                });
            }
            if (!testFwdRuleFlag) {
                assert.fail('Forwarding rules not found');
            }
        })
        .catch(err => Promise.reject(err));
}
function checkRoutes(selfIps) {
    return new Promise((resolve, reject) => {
        compute.routes.list(request, (err, response) => {
            if (err) {
                reject(err);
            } else {
                resolve(response);
            }
        });
    })
        .then((data) => {
            const routes = data.data.items || [];
            let testRouteFlag = false;

            if (routes) {
                routes.forEach((route) => {
                    if (route.name.indexOf(deploymentInfo.deploymentId) !== -1) {
                        testRouteFlag = selfIps.indexOf(route.nextHopIp) !== -1;
                    }
                });
            }
            if (!testRouteFlag) {
                assert.fail('Route not found');
            }
        })
        .catch(err => Promise.reject(err));
}
function getVms(hostname) {
    return new Promise((resolve, reject) => {
        compute.instances.list(request, (err, response) => {
            if (err) {
                reject(err);
            } else {
                resolve(response);
            }
        });
    })
        .then((data) => {
            const instances = data.data.items || [];
            const vms = [];
            instances.forEach((vm) => {
                if (vm.labels) {
                    if (Object.values(vm.labels)
                        .indexOf(networkInterfaceTagValue) !== -1
                        && Object.keys(vm.labels)
                            .indexOf(storageTagKey) !== -1) {
                        if (vm.name.indexOf(hostname) !== -1) {
                            vms.push(vm);
                        }
                    }
                }
            });
            return Promise.resolve(vms);
        })
        .catch(err => Promise.reject(err));
}

function getRoutes(selfIps) {
    return new Promise((resolve, reject) => {
        compute.routes.list(request, (err, response) => {
            if (err) {
                reject(err);
            } else {
                resolve(response);
            }
        });
    })
        .then((data) => {
            const routes = data.data.items || [];
            const result = [];
            if (routes) {
                routes.forEach((route) => {
                    if (route.name.indexOf(deploymentInfo.deploymentId) !== -1
                        && selfIps.indexOf(route.nextHopIp) !== -1) {
                        result.push(route);
                    }
                });
            }
            return Promise.resolve(result);
        })
        .catch(err => Promise.reject(err));
}

describe('Provider: GCP', () => {
    let primarySelfIps = [];
    let secondarySelfIps = [];
    let virtualAddresses = [];
    const vms = [];

    before(() => configureAuth()
        .then((authClient) => {
            request = {
                project: JSON.parse(process.env.GOOGLE_CREDENTIALS).project_id,
                auth: authClient,
                region: deploymentInfo.region,
                zone: deploymentInfo.zone
            };
            return utils.getAuthToken(dutPrimary.ip, dutPrimary.port, dutPrimary.username, dutPrimary.password);
        })
        .then((data) => {
            const uri = '/mgmt/tm/net/self';
            dutPrimary.authData = data;
            const options = funcUtils.makeOptions({ authToken: dutPrimary.authData.token });
            options.port = dutPrimary.port;
            return utils.makeRequest(dutPrimary.ip, uri, options);
        })
        .then((data) => {
            primarySelfIps = data.items.map(i => i.address.split('/')[0]);
            return utils.getAuthToken(dutPrimary.ip, dutPrimary.port, dutPrimary.username, dutPrimary.password);
        })
        .then(() => {
            const uri = '/mgmt/tm/ltm/virtual-address';
            const options = funcUtils.makeOptions({ authToken: dutPrimary.authData.token });
            options.port = dutPrimary.port;
            return utils.makeRequest(dutPrimary.ip, uri, options);
        })
        .then((data) => {
            virtualAddresses = data.items.map(i => i.address.split('/')[0]);
        })
        .then(() => utils.getAuthToken(dutSecondary.ip, dutSecondary.port, dutSecondary.username,
            dutSecondary.password))
        .then((data) => {
            dutSecondary.authData = data;
            const uri = '/mgmt/tm/net/self';
            const options = funcUtils.makeOptions({ authToken: dutSecondary.authData.token });
            options.port = dutSecondary.port;
            return utils.makeRequest(dutSecondary.ip, uri, options);
        })
        .then((data) => {
            secondarySelfIps = data.items.map(i => i.address.split('/')[0]);
        })
        .catch(err => Promise.reject(err)));

    after(() => {
        Object.keys(require.cache).forEach((key) => {
            delete require.cache[key];
        });
    });

    it('validate Google Primary VM IP Addresess', function () {
        this.retries(RETRIES.SHORT);

        return new Promise((resolve, reject) => {
            compute.instances.list(request, (err, response) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(response);
                }
            });
        })
            .then((data) => {
                const instances = data.data.items || [];

                if (instances) {
                    instances.forEach((vm) => {
                        if (vm.labels) {
                            if (Object.values(vm.labels)
                                .indexOf(storageTagValue) !== -1
                            && Object.keys(vm.labels)
                                .indexOf(storageTagKey) !== -1) {
                                vms.push(vm);
                            }
                        }
                    });
                }
                const networkIp = [];
                vms.forEach((vm) => {
                    vm.networkInterfaces.forEach((nic) => {
                        networkIp.push(nic.networkIP);
                    });
                });
                primarySelfIps.forEach((ipAddress) => {
                    if (networkIp.indexOf(ipAddress) !== -1) {
                        assert.ok(true);
                    } else {
                        assert.ok(false);
                    }
                });
                secondarySelfIps.forEach((ipAddress) => {
                    if (networkIp.indexOf(ipAddress) !== -1) {
                        assert.ok(true);
                    } else {
                        assert.ok(false);
                    }
                });
            })
            .catch(err => Promise.reject(err));
    });

    it('should check network interface alias IP(s) contains virtual addresses (primary)', function () {
        this.retries(RETRIES.LONG);

        return checkAliasIPs(dutPrimary.hostname, virtualAddresses)
            .catch(err => Promise.reject(err));
    });

    it('should check forwarding rule target matches instance (primary)', function () {
        this.retries(RETRIES.LONG);

        return checkForwardingRules(dutPrimary.hostname)
            .catch(err => Promise.reject(err));
    });

    it('should check route(s) next hop matches self IP (primary)', function () {
        this.retries(RETRIES.LONG);

        return checkRoutes(primarySelfIps)
            .catch(err => Promise.reject(err));
    });

    it('should force BIG-IP (primary) to standby', () => funcUtils.forceStandby(
        dutPrimary.ip, dutPrimary.port, dutPrimary.username, dutPrimary.password
    ));

    it('should check network interface alias IP(s) contains virtual addresses (secondary)', function () {
        this.retries(RETRIES.LONG);

        return checkAliasIPs(dutSecondary.hostname, virtualAddresses)
            .catch(err => Promise.reject(err));
    });

    it('should check forwarding rule target matches instance (secondary)', function () {
        this.retries(RETRIES.LONG);

        return checkForwardingRules(dutSecondary.hostname)
            .catch(err => Promise.reject(err));
    });

    it('should check route(s) next hop matches self IP (secondary)', function () {
        this.retries(RETRIES.LONG);

        return checkRoutes(secondarySelfIps)
            .catch(err => Promise.reject(err));
    });

    it('should check route(s) next hop matches self IP (secondary)', function () {
        this.retries(RETRIES.LONG);

        return checkRoutes(secondarySelfIps)
            .catch(err => Promise.reject(err));
    });
    it('should wait 30 seconds before force standby', () => new Promise(
        resolve => setTimeout(resolve, 30000)
    ));

    it('should force BIG-IP (secondary) to standby', () => funcUtils.forceStandby(
        dutSecondary.ip, dutSecondary.port, dutSecondary.username, dutSecondary.password
    ));

    // it('should wait 30 seconds after force standby', () => new Promise(
    //     resolve => setTimeout(resolve, 30000)
    // ));

    it('should check network interface alias IP(s) contains virtual addresses (primary)', function () {
        this.retries(RETRIES.LONG);

        return checkAliasIPs(dutPrimary.hostname, virtualAddresses)
            .catch(err => Promise.reject(err));
    });

    it('should check forwarding rule target matches instance (primary)', function () {
        this.retries(RETRIES.LONG);

        return checkForwardingRules(dutPrimary.hostname)
            .catch(err => Promise.reject(err));
    });

    it('should check route(s) next hop matches self IP (primary)', function () {
        this.retries(RETRIES.LONG);

        return checkRoutes(primarySelfIps)
            .catch(err => Promise.reject(err));
    });

    // Flapping scenario: should check failover objects get assigned back to BIG-IP (primary)

    // ideally this would be replaced by a check for previous failover task success completion
    // GCP: long wait time to avoid long-running failover race conditions
    // it('Flapping scenario: should wait 60 seconds', () => new Promise(
    //     resolve => setTimeout(resolve, 60000)
    // ));
    it('wait until taskState is success on primary BIG-IP', function () {
        this.retries(RETRIES.MEDIUM);
        return new Promise(
            resolve => setTimeout(resolve, 5000)
        )
            .then(() => funcUtils.getTriggerTaskStatus(dutPrimary.ip,
                {
                    taskState: constants.FAILOVER_STATES.PASS,
                    authToken: dutPrimary.authData.token,
                    hostname: dutPrimary.hostname,
                    port: dutPrimary.port
                }))
            .then((data) => {
                assert(data.boolean, data);
            })
            .catch(err => Promise.reject(err));
    });

    it('Flapping scenario: should force BIG-IP (primary) to standby', () => funcUtils.forceStandby(
        dutPrimary.ip, dutPrimary.port, dutPrimary.username, dutPrimary.password
    ));

    it('wait until taskState is running on standby BIG-IP', function () {
        this.retries(RETRIES.MEDIUM);
        return new Promise(
            resolve => setTimeout(resolve, 1000)
        )
            .then(() => funcUtils.getTriggerTaskStatus(dutSecondary.ip,
                {
                    taskState: constants.FAILOVER_STATES.RUN,
                    authToken: dutSecondary.authData.token,
                    hostname: dutSecondary.hostname,
                    port: dutSecondary.port
                }))
            .then((data) => {
                assert(data.boolean, data);
            })
            .catch(err => Promise.reject(err));
    });

    it('Flapping scenario: should force BIG-IP (secondary) to standby', () => funcUtils.forceStandby(
        dutSecondary.ip, dutSecondary.port, dutSecondary.username, dutSecondary.password
    ));

    it('wait until taskState is success on primary BIG-IP', function () {
        this.retries(RETRIES.MEDIUM);
        return new Promise(
            resolve => setTimeout(resolve, 5000)
        )
            .then(() => funcUtils.getTriggerTaskStatus(dutPrimary.ip,
                {
                    taskState: constants.FAILOVER_STATES.PASS,
                    authToken: dutPrimary.authData.token,
                    hostname: dutPrimary.hostname,
                    port: dutPrimary.port
                }))
            .then((data) => {
                assert(data.boolean, data);
            })
            .catch(err => Promise.reject(err));
    });

    it('Flapping scenario: should check network interface alias IP(s) contains virtual addresses (primary)', function () {
        this.retries(RETRIES.LONG);

        return checkAliasIPs(dutPrimary.hostname, virtualAddresses)
            .catch(err => Promise.reject(err));
    });

    it('Flapping scenario: should check forwarding rule target matches instance (primary)', function () {
        this.retries(RETRIES.LONG);

        return checkForwardingRules(dutPrimary.hostname)
            .catch(err => Promise.reject(err));
    });

    it('Flapping scenario: should check route(s) next hop matches self IP (primary)', function () {
        this.retries(RETRIES.LONG);

        return checkRoutes(primarySelfIps)
            .catch(err => Promise.reject(err));
    });

    it('Should retrieve addresses and routes for primary BIG-IP', function () {
        this.retries(RETRIES.SHORT);
        const expectedResult = {
            instance: dutPrimary.hostname,
            addresses: [],
            routes: []
        };
        return Promise.all([
            getVms(dutPrimary.hostname),
            getRoutes(primarySelfIps)
        ])
            .then((results) => {
                const privateIps = [];
                results[0].forEach((vm) => {
                    vm.networkInterfaces.forEach((address) => {
                        let vmPublicIp = null;
                        if (address.accessConfigs) {
                            vmPublicIp = address.accessConfigs[0].natIP;
                        }
                        privateIps.push(address.networkIP);
                        expectedResult.addresses.push({
                            publicIpAddress: vmPublicIp,
                            privateIpAddress: address.networkIP,
                            networkInterfaceId: address.name
                        });
                    });
                });
                results[1].forEach((route) => {
                    if (privateIps.includes(route.nextHopIp)) {
                        expectedResult.routes.push({
                            routeTableId: route.id,
                            routeTableName: route.name,
                            networkId: route.network
                        });
                    }
                });
            })
            .then(() => funcUtils.getInspectStatus(dutPrimary.ip, {
                authToken: dutPrimary.authData.token,
                port: dutPrimary.port
            }))
            .then((data) => {
                assert.deepStrictEqual(data.instance, expectedResult.instance);
                assert.deepStrictEqual(data.addresses, expectedResult.addresses);
                assert.deepStrictEqual(data.routes, expectedResult.routes);
            })
            .catch(err => Promise.reject(err));
    });

    it('Should retrieve addresses and not routes for secondary BIG-IP', function () {
        this.retries(RETRIES.SHORT);
        const expectedResult = {
            instance: dutSecondary.hostname,
            addresses: []
        };
        return Promise.all([
            getVms(dutSecondary.hostname),
            getRoutes(secondarySelfIps)
        ])
            .then((results) => {
                const privateIps = [];
                results[0].forEach((vm) => {
                    vm.networkInterfaces.forEach((address) => {
                        let vmPublicIp = null;
                        if (address.accessConfigs) {
                            vmPublicIp = address.accessConfigs[0].natIP;
                        }
                        privateIps.push(address.networkIP);
                        expectedResult.addresses.push({
                            publicIpAddress: vmPublicIp,
                            privateIpAddress: address.networkIP,
                            networkInterfaceId: address.name
                        });
                    });
                });
                assert(results[1].length === 0, 'Expect no routes to be associated with standby device');
            })
            .then(() => funcUtils.getInspectStatus(dutSecondary.ip,
                {
                    authToken: dutSecondary.authData.token,
                    port: dutSecondary.port
                }))
            .then((data) => {
                assert.deepStrictEqual(data.instance, expectedResult.instance);
                assert.deepStrictEqual(data.addresses, expectedResult.addresses);
                assert.deepStrictEqual(data.routes, []);
            })
            .catch(err => Promise.reject(err));
    });
});
