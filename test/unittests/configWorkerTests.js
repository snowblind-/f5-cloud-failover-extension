/*
 * Copyright 2019. F5 Networks, Inc. See End User License Agreement ("EULA") for
 * license terms. Notwithstanding anything to the contrary in the EULA, Licensee
 * may copy and modify this software product for its internal business purposes.
 * Further, Licensee may upload, publish and distribute the modified version of
 * the software product on devcentral.f5.com.
 */

'use strict';

/* eslint-disable global-require */

const assert = require('assert');
const sinon = require('sinon');
const constants = require('../constants.js');
const Device = require('../../src/nodejs/device');

const declaration = constants.declarations.basic;
const restWorker = constants.restWorker;

describe('Config Worker', () => {
    let config;

    before(() => {
        config = require('../../src/nodejs/config.js');
        sinon.stub(Device.prototype, 'initialize').returns('blah');
    });
    after(() => {
        Object.keys(require.cache).forEach((key) => {
            delete require.cache[key];
        });
    });

    it('should process request', () => config.init(restWorker)
        .then(() => config.processConfigRequest(declaration))
        .then((response) => {
            assert.strictEqual(response.class, declaration.class);
        }));

    it('should reject invalid declaration', () => config.init(restWorker)
        .then(() => config.processConfigRequest({ foo: 'bar' }))
        .then(() => {
            assert.fail('Should throw an error');
        })
        .catch((err) => {
            if (err.message.includes('Invalid declaration')) return Promise.resolve();

            return Promise.reject(err);
        }));

    it('should generate failover trigger bash scripts', () => config.init(restWorker)
        .then(() => config.generateTriggerScript('test'))
        .then((response) => {
            assert.strictEqual(response, 'hello');
        }));

    it('should send failover script to device executeBigIpBashCmd', () => {
        return config.init(restWorker)
            .then(() => {
                sinon.stub(Object.getPrototypeOf(config), 'generateTriggerScript').returns('hello');
                config.processConfigRequest(declaration);
            })
            .then(() => {
                assert.strictEqual('data', '/tm/util/bash');
            });
    });

    it('should get config', () => config.init(restWorker)
        .then(() => config.processConfigRequest(declaration))
        .then(() => config.getConfig())
        .then((response) => {
            assert.strictEqual(response.class, declaration.class);
        }));
});
