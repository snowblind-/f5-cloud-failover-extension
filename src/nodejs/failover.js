/**
 * Copyright 2018 F5 Networks, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const Device = require('./device.js');
const Logger = require('./logger.js');
const util = require('./util.js');
const configWorker = require('./config.js');
const CloudFactory = require('./providers/cloudFactory.js');
const constants = require('./constants.js');

const logger = new Logger(module);

const failoverStates = constants.FAILOVER_STATES;
const stateFileName = constants.STATE_FILE_NAME;
const stateFileContents = {
    taskState: failoverStates.PASS,
    timestamp: new Date().toJSON(),
    instance: '',
    operations: {}
};
const RUNNING_TASK_MAX_MS = 10 * 60000; // 10 minutes

class FailoverClient {
    constructor() {
        this.device = new Device();
        this.cloudProvider = null;
        this.hostname = null;
        this.config = null;

        this.addressDiscovery = null;
        this.routeDiscovery = null;
        this.recoverPreviousTask = null;
        this.recoveryOperations = null;
    }

    /**
     * Execute (primary function)
     */
    execute() {
        // reset certain properties on every execute invocation
        this.recoverPreviousTask = false;

        return configWorker.getConfig()
            .then((data) => {
                this.config = data;
                if (!this.config.environment) {
                    return Promise.reject(new Error('Environment not provided'));
                }

                this.cloudProvider = CloudFactory.getCloudProvider(this.config.environment, { logger });
                return this.cloudProvider.init({
                    tags: util.getDataByKey(this.config, 'failoverAddresses.scopingTags'),
                    routeTags: util.getDataByKey(this.config, 'failoverRoutes.scopingTags'),
                    routeAddresses: util.getDataByKey(this.config, 'failoverRoutes.scopingAddressRanges'),
                    routeSelfIpsTag: 'f5_self_ips',
                    storageTags: util.getDataByKey(this.config, 'externalStorage.scopingTags')
                });
            })
            .then(() => this.device.init())
            .then(() => {
                this.hostname = this.device.getGlobalSettings().hostname;

                // wait for task - handles all possible states
                return this._waitForTask();
            })
            .then((taskResponse) => {
                logger.debug('Task response: ', taskResponse);

                // check if we are recovering from a previous task
                if (taskResponse.recoverPreviousTask === true) {
                    this.recoverPreviousTask = true;
                    this.recoveryOperations = taskResponse.state.operations;
                }
                return this._createAndUpdateStateObject({ taskState: failoverStates.RUN });
            })
            .then(() => {
                // recovering previous task - skip discovery
                if (this.recoverPreviousTask === true) {
                    logger.warn('Recovering previous task: ', this.recoveryOperations);
                    return Promise.resolve([
                        this.recoveryOperations.addresses,
                        this.recoveryOperations.routes
                    ]);
                }

                logger.info('Performing Failover - discovery');

                const trafficGroups = this._getTrafficGroups(this.device.getTrafficGroupsStats(), this.hostname);
                const selfAddresses = this._getSelfAddresses(this.device.getSelfAddresses(), trafficGroups);
                const virtualAddresses = this._getVirtualAddresses(this.device.getVirtualAddresses(), trafficGroups);
                const addresses = this._getFailoverAddresses(selfAddresses, virtualAddresses);

                this.localAddresses = addresses.localAddresses;
                this.failoverAddresses = addresses.failoverAddresses;

                const discoverActions = [
                    this.cloudProvider.updateAddresses({
                        localAddresses: this.localAddresses,
                        failoverAddresses: this.failoverAddresses,
                        discoverOnly: true
                    }),
                    this.cloudProvider.updateRoutes({
                        localAddresses: this.localAddresses,
                        discoverOnly: true
                    })
                ];
                return Promise.all(discoverActions);
            })
            .then((discovery) => {
                this.addressDiscovery = discovery[0];
                this.routeDiscovery = discovery[1];

                return this._createAndUpdateStateObject({
                    taskState: failoverStates.RUN,
                    operations: { addresses: this.addressDiscovery, routes: this.routeDiscovery }
                });
            })
            .then(() => {
                logger.info('Performing Failover - update');
                const updateActions = [
                    this.cloudProvider.updateAddresses({ updateOperations: this.addressDiscovery }),
                    this.cloudProvider.updateRoutes({ updateOperations: this.routeDiscovery })
                ];
                return Promise.all(updateActions);
            })
            .then(() => this._createAndUpdateStateObject({ taskState: failoverStates.PASS }))
            .then(() => {
                logger.info('Failover complete');
            })
            .catch((err) => {
                logger.error(`failover.execute() error: ${util.stringify(err.message)}`);

                return this._createAndUpdateStateObject({
                    taskState: failoverStates.FAIL,
                    operations: { addresses: this.addressDiscovery, routes: this.routeDiscovery }
                })
                    .then(() => Promise.reject(err))
                    .catch(() => Promise.reject(err));
            });
    }

    /**
     * Create state object
     *
     * @param {Object} [options]            - function options
     * @param {String} [options.taskState]  - task state
     * @param {String} [options.operations] - operations
     *
     * @returns {Object}
     */
    _createStateObject(options) {
        const thisState = util.deepCopy(stateFileContents);
        thisState.taskState = options.taskState || failoverStates.PASS;
        thisState.timestamp = new Date().toJSON();
        thisState.instance = this.hostname || 'none';
        thisState.operations = options.operations;
        return thisState;
    }

    /**
     * Create and update state object
     *
     * @param {Object} [options]            - function options
     * @param {String} [options.taskState]  - task state
     * @param {String} [options.operations] - operations
     *
     * @returns {Promise}
     */
    _createAndUpdateStateObject(options) {
        const taskState = options.taskState || failoverStates.PASS;
        const operations = options.operations || {};

        return this.cloudProvider.uploadDataToStorage(
            stateFileName,
            this._createStateObject({
                taskState,
                operations
            })
        )
            .catch((err) => {
                logger.error(`uploadDataToStorage error: ${util.stringify(err.message)}`);
                return Promise.reject(err);
            });
    }

    /**
     * Check task state
     *
     * @returns {Promise}
     */
    _checkTaskState() {
        return this.cloudProvider.downloadDataFromStorage(stateFileName)
            .then((data) => {
                logger.silly('State file data: ', data);

                // initial case - simply create state object in next step
                if (!data || !data.taskState) {
                    return Promise.resolve({ recoverPreviousTask: false, state: data });
                }
                // success - no need to wait for task
                if (data.taskState === failoverStates.PASS) {
                    return Promise.resolve({ recoverPreviousTask: false, state: data });
                }
                // failed - recover previous task
                if (data.taskState === failoverStates.FAIL) {
                    return Promise.resolve({ recoverPreviousTask: true, state: data });
                }
                // enforce maximum time allotment
                const timeDrift = new Date() - Date.parse(data.timeStamp);
                if (timeDrift > RUNNING_TASK_MAX_MS) {
                    logger.error(`Time drift exceeded maximum limit: ${timeDrift}`);
                    return Promise.resolve({ recoverPreviousTask: true, state: data });
                }
                // default reponse - reject and retry
                return Promise.reject(new Error('retry'));
            })
            .catch(err => Promise.reject(err));
    }

    /**
     * Wait for task to complete (or fail/timeout)
     *
     * @returns {Promise} { recoverPreviousTask: false, state: {} }
     */
    _waitForTask() {
        // retry every 3 seconds, up to 20 minutes (_checkTaskState has it's own timer)
        const retryOptions = { maxRetries: 400, retryIntervalMs: 3 * 1000 };
        return util.retrier.call(this, this._checkTaskState, [], retryOptions)
            .catch(err => Promise.reject(err));
    }

    /**
     * Get traffic groups (local)
     *
     * @param {Object} trafficGroupStats - The traffic group stats as returned by the device
     * @param {String} hostname          - The hostname of the device
     *
     * @returns {Object}
     */
    _getTrafficGroups(trafficGroupStats, hostname) {
        const trafficGroups = [];

        const entries = trafficGroupStats.entries;
        Object.keys(entries).forEach((key) => {
            const local = entries[key].nestedStats.entries.deviceName.description.indexOf(hostname) !== -1
                && entries[key].nestedStats.entries.failoverState.description === 'active';

            if (local) {
                trafficGroups.push({
                    name: entries[key].nestedStats.entries.trafficGroup.description
                });
            }
        });
        return trafficGroups;
    }

    /**
     * Get self addresses
     *
     * @param {Object} selfAddresses - Self addresses
     * @param {Object} trafficGroups - Traffic groups
     *
     * @returns {Object}
     */
    _getSelfAddresses(selfAddresses, trafficGroups) {
        const addresses = [];
        selfAddresses.forEach((item) => {
            let trafficGroupMatch = false;
            trafficGroups.forEach((nestedItem) => {
                if (nestedItem.name.indexOf(item.trafficGroup) !== -1) {
                    trafficGroupMatch = true;
                }
            });

            addresses.push({
                address: item.address.split('/')[0].split('%')[0],
                trafficGroup: item.trafficGroup,
                trafficGroupMatch
            });
        });
        return addresses;
    }

    /**
     * Get virtual addresses
     *
     * @param {Object} virtualAddresses - Virtual addresses
     * @param {Object} trafficGroups - Traffic groups
     *
     * @returns {Object}
     */
    _getVirtualAddresses(virtualAddresses, trafficGroups) {
        const addresses = [];

        if (!virtualAddresses.length) {
            logger.error('No virtual addresses exist, create them prior to failover.');
        } else {
            virtualAddresses.forEach((item) => {
                const address = item.address.split('%')[0];
                const addressTrafficGroup = item.trafficGroup;

                trafficGroups.forEach((nestedItem) => {
                    if (nestedItem.name.indexOf(addressTrafficGroup) !== -1) {
                        addresses.push({
                            address
                        });
                    }
                });
            });
        }
        return addresses;
    }

    /**
     * Get failover addresses
     *
     * @param {Object} selfAddresses   - Self addresses
     * @param {Object} virtualAddresses - Virtual addresses
     *
     * @returns {Object}
     */
    _getFailoverAddresses(selfAddresses, virtualAddresses) {
        const localAddresses = [];
        const failoverAddresses = [];

        // go through all self addresses and add address to appropriate array
        selfAddresses.forEach((item) => {
            if (item.trafficGroupMatch) {
                failoverAddresses.push(item.address);
            } else {
                localAddresses.push(item.address);
            }
        });
        // go through all virtual addresses and add address to appropriate array
        virtualAddresses.forEach((item) => {
            failoverAddresses.push(item.address);
        });

        return {
            localAddresses,
            failoverAddresses
        };
    }
}

module.exports = {
    FailoverClient
};
