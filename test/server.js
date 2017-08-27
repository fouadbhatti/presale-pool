const TestRPC = require("ethereumjs-testrpc");
const Web3 = require('web3');

const server = TestRPC.server();

module.exports = {
    setUp: function() {
        return new Promise(
            function (resolve, reject) {
                let port = 8545;                
                server.listen(port, function(err, blockchain) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve({
                        addresses: Object.keys(blockchain.accounts),
                        web3: new Web3(new Web3.providers.HttpProvider("http://localhost:"+port))
                    });
                });
            }
        );
    },

    tearDown: function() {
        return new Promise(
            function (resolve, reject) {
                server.close(function(err) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve();
                });
            }
        );
    }
}