const fs = require("fs");
const chai = require('chai');
const solc = require('solc')

const server = require('./server');

const assert = chai.assert;
const expect = chai.expect;

async function deployContract(web3, contractName, creatorAddress, initialBalance) {
    let source = fs.readFileSync(`./contracts/${contractName}.sol`, 'utf8');
    let compiledContract = solc.compile(
        source, 1
    ).contracts[`:${contractName}`];
    let abi = compiledContract.interface;
    let bytecode = compiledContract.bytecode;
    let gasEstimate = await web3.eth.estimateGas({data: bytecode});
    let PresalePool = new web3.eth.Contract(JSON.parse(abi));

    let sendOptions = {
        from: creatorAddress,
        gas: 2*gasEstimate,
    };
    if (initialBalance) {
        sendOptions.value = initialBalance;
    }

    return PresalePool.deploy({ data: bytecode }).send(sendOptions);
}

describe('PresalePool', () => {
    let creator;
    let buyer1;
    let buyer2;
    let payoutAddress;
    let web3;

    before(async () => {
        let result = await server.setUp();
        web3 = result.web3;
        creator = result.addresses[0];
        buyer1 = result.addresses[1];
        buyer2 = result.addresses[2];
        payoutAddress = result.addresses[4];
    });

    after(() => {
        server.tearDown();        
    });

    async function verifyState(expectedBalances) {
        let total = 0;

        for (let [address, balance] of Object.entries(expectedBalances)) {
            total += balance;
            expect(await PresalePool.methods.balances(address).call())
            .to.equal(web3.utils.toWei(balance, "ether"));
        }

        expect(await PresalePool.methods.totalDeposits().call())
        .to.equal(web3.utils.toWei(total, "ether"));

        let poolBalance = await web3.eth.getBalance(
            PresalePool.options.address
        );
        expect(poolBalance).to.equal(web3.utils.toWei(total, "ether"));
    }

    it('can be deployed without balance', async () => {
        PresalePool = await deployContract(web3, "PresalePool", creator);
        let poolBalance = await web3.eth.getBalance(
            PresalePool.options.address
        );
        expect(poolBalance).to.equal(web3.utils.toWei(0, "ether"));
        let result = await PresalePool.methods.totalDeposits().call();
        expect(await PresalePool.methods.totalDeposits().call())
        .to.equal(web3.utils.toWei(0, "ether"))
    });

    it('can be deployed with balance', async () => {
        PresalePool = await deployContract(
            web3, "PresalePool", creator, web3.utils.toWei(5, "ether")
        );
        let expectedBalances = {}
        expectedBalances[creator] = 5;
        await verifyState(expectedBalances);
    });

    it('accepts deposits', async () => {
        PresalePool = await deployContract(web3, "PresalePool", creator);

        await web3.eth.sendTransaction({
            from: buyer1,
            to: PresalePool.options.address,
            value: web3.utils.toWei(5, "ether")
        });

        await web3.eth.sendTransaction({
            from: buyer1,
            to: PresalePool.options.address,
            value: web3.utils.toWei(5, "ether")
        });

        await web3.eth.sendTransaction({
            from: buyer2,
            to: PresalePool.options.address,
            value: web3.utils.toWei(3, "ether")
        });

        let expectedBalances = {}
        expectedBalances[buyer1] = 10;
        expectedBalances[buyer2] = 3;        
        await verifyState(expectedBalances);
    });

    it('performs refunds', async () => {
        PresalePool = await deployContract(web3, "PresalePool", creator);

        await web3.eth.sendTransaction({
            from: buyer1,
            to: PresalePool.options.address,
            value: web3.utils.toWei(5, "ether")
        });

        let expectedBalances = {}
        expectedBalances[buyer1] = 5;
        await verifyState(expectedBalances);
        let buyerBalance = await web3.eth.getBalance(buyer1);        

        await web3.eth.sendTransaction({
            from: buyer1,
            to: PresalePool.options.address,
            value: web3.utils.toWei(0, "ether")
        });

        expectedBalances[buyer1] = 0;
        await verifyState(expectedBalances);
        
        let buyerBalanceAfterRefund = await web3.eth.getBalance(buyer1);
        let fiveEther = web3.utils.toWei(5, "ether");
        let difference = parseInt(buyerBalanceAfterRefund) - parseInt(buyerBalance);
        expect(difference / fiveEther).to.be.within(.98, 1.0);
    });

    it('does not refund participants without deposits', async () => {
        PresalePool = await deployContract(web3, "PresalePool", creator);

        await web3.eth.sendTransaction({
            from: buyer1,
            to: PresalePool.options.address,
            value: web3.utils.toWei(5, "ether")
        });

        await web3.eth.sendTransaction({
            from: buyer2,
            to: PresalePool.options.address,
            value: web3.utils.toWei(0, "ether")
        });

        let expectedBalances = {}
        expectedBalances[buyer1] = 5;
        await verifyState(expectedBalances);
    });

    it('does not allow consecutive double refunds', async () => {
        PresalePool = await deployContract(web3, "PresalePool", creator);

        await web3.eth.sendTransaction({
            from: buyer1,
            to: PresalePool.options.address,
            value: web3.utils.toWei(5, "ether")
        });

        await web3.eth.sendTransaction({
            from: buyer2,
            to: PresalePool.options.address,
            value: web3.utils.toWei(3, "ether")
        });

        let expectedBalances = {}
        expectedBalances[buyer1] = 5;
        expectedBalances[buyer2] = 3;        
        await verifyState(expectedBalances);
        
        await web3.eth.sendTransaction({
            from: buyer2,
            to: PresalePool.options.address,
            value: web3.utils.toWei(0, "ether")
        });

        expectedBalances[buyer2] = 0;        
        await verifyState(expectedBalances);
        
        await web3.eth.sendTransaction({
            from: buyer2,
            to: PresalePool.options.address,
            value: web3.utils.toWei(0, "ether")
        });

        await verifyState(expectedBalances);
    });

    it('does not allow deposits after pool is closed', async () => {
        PresalePool = await deployContract(web3, "PresalePool", creator);
        await PresalePool.methods.closeAllowAll(
            payoutAddress
        ).send({ from: creator });

        try {
            await web3.eth.sendTransaction({
                from: buyer1,
                to: PresalePool.options.address,
                value: web3.utils.toWei(5, "ether")
            });
         }
         catch (e) {}

        let expectedBalances = {}
        expectedBalances[buyer1] = 0;
        await verifyState(expectedBalances);
    });

    it('can only be closed once', async () => {
        PresalePool = await deployContract(web3, "PresalePool", creator);
        await web3.eth.sendTransaction({
            from: buyer2,
            to: PresalePool.options.address,
            value: web3.utils.toWei(3, "ether")
        });

        await PresalePool.methods.closeAllowAll(
            payoutAddress
        ).send({ from: creator });
        
        try {
            await PresalePool.methods.closeAllowAll(
                payoutAddress
            ).send({ from: creator });
            assert.fail(0, 1, 'Exception not thrown');            
        }
        catch (e) {}
    });

    it('only allows creator to close the pool', async () => {
        PresalePool = await deployContract(web3, "PresalePool", creator);
        try {
            await PresalePool.methods.closeAllowAll(
                payoutAddress
            ).send({ from: buyer1 });
        }
        catch (e) {}

        await web3.eth.sendTransaction({
            from: buyer2,
            to: PresalePool.options.address,
            value: web3.utils.toWei(5, "ether")
        });

        let expectedBalances = {}
        expectedBalances[buyer2] = 5;
        await verifyState(expectedBalances);
    });

    it('recovers if transfer to payout address fails when closing', async () => {
        PresalePool = await deployContract(web3, "PresalePool", creator);
        TestToken = await deployContract(web3, "TestToken", creator);

        await web3.eth.sendTransaction({
            from: buyer2,
            to: PresalePool.options.address,
            value: web3.utils.toWei(5, "ether")
        });


        try {
            await PresalePool.methods.closeAllowAll(
                TestToken.options.address
            ).send({ from: creator });
        }
        catch (e) {}

        let expectedBalances = {}
        expectedBalances[buyer2] = 5;
        await verifyState(expectedBalances);
        expect(await PresalePool.methods.closed().call())
        .to.equal(false);
    });

    it('kill transfers balance to creator', async () => {
        PresalePool = await deployContract(web3, "PresalePool", creator);
        await web3.eth.sendTransaction({
            from: buyer2,
            to: PresalePool.options.address,
            value: web3.utils.toWei(5, "ether")
        });

        let balance = await web3.eth.getBalance(creator);

        await PresalePool.methods.kill().send({ from: creator });

        let balanceAfterKill = await web3.eth.getBalance(creator);
        let fiveEther = web3.utils.toWei(5, "ether");
        let difference = parseInt(balanceAfterKill) - parseInt(balance);
        expect(difference / fiveEther).to.be.within(.98, 1.0);
    });

    it('only allows creator to kill the pool', async () => {
        PresalePool = await deployContract(web3, "PresalePool", creator);
        await web3.eth.sendTransaction({
            from: buyer2,
            to: PresalePool.options.address,
            value: web3.utils.toWei(5, "ether")
        });

        try {
            await PresalePool.methods.kill().send({ from: buyer1 });
        }
        catch (e) {}

        let expectedBalances = {}        
        expectedBalances[buyer2] = 5;
        await verifyState(expectedBalances);
    });

    it('does not allow refunds after pool is closed with no whitelist', async () => {
        PresalePool = await deployContract(web3, "PresalePool", creator);
        await web3.eth.sendTransaction({
            from: buyer1,
            to: PresalePool.options.address,
            value: web3.utils.toWei(5, "ether")
        });
        await PresalePool.methods.closeAllowAll(payoutAddress).send(
            { from: creator }
        );

        try {
            await web3.eth.sendTransaction({
                from: buyer1,
                to: PresalePool.options.address,
                value: web3.utils.toWei(0, "ether")
            });
        } catch(e) {}

        expect(await PresalePool.methods.balances(buyer1).call())
        .to.equal(web3.utils.toWei(5, "ether"));
        expect(await PresalePool.methods.totalDeposits().call())
        .to.equal(web3.utils.toWei(5, "ether"));
    });

    it('allows refunds after pool is closed from participants not in whitelist', async () => {
        PresalePool = await deployContract(web3, "PresalePool", creator);
        await web3.eth.sendTransaction({
            from: buyer1,
            to: PresalePool.options.address,
            value: web3.utils.toWei(5, "ether")
        });
        await PresalePool.methods.close(payoutAddress, []).send(
            { from: creator }
        );

        let buyerBalance = await web3.eth.getBalance(buyer1);  

        await web3.eth.sendTransaction({
            from: buyer1,
            to: PresalePool.options.address,
            value: web3.utils.toWei(0, "ether")
        });

        expect(await PresalePool.methods.balances(address).call())
        .to.equal(web3.utils.toWei(0, "ether"));

        let buyerBalanceAfterRefund = await web3.eth.getBalance(buyer1);
        let fiveEther = web3.utils.toWei(5, "ether");
        let difference = parseInt(buyerBalanceAfterRefund) - parseInt(buyerBalance);
        expect(difference / fiveEther).to.be.within(.98, 1.0);
    });

    it('allows distribution of tokens', async () => {
        PresalePool = await deployContract(web3, "PresalePool", creator);
        TestToken = await deployContract(web3, "TestToken", creator);

        await web3.eth.sendTransaction({
            from: buyer1,
            to: PresalePool.options.address,
            value: web3.utils.toWei(1, "ether")
        });
        await web3.eth.sendTransaction({
            from: buyer2,
            to: PresalePool.options.address,
            value: web3.utils.toWei(4, "ether")
        });

        await PresalePool.methods.closeAllowAll(
            creator
        ).send({ from: creator });

        await PresalePool.methods.setToken(
            TestToken.options.address
        ).send({ from: creator });
        await TestToken.methods.transfer(
            PresalePool.options.address, 100
        ).send({ from: creator });        

        await web3.eth.sendTransaction({
            from: buyer1,
            to: PresalePool.options.address,
            value: web3.utils.toWei(0, "ether")
        });
        await web3.eth.sendTransaction({
            from: buyer2,
            to: PresalePool.options.address,
            value: web3.utils.toWei(0, "ether")
        });

        expect(await PresalePool.methods.balances(buyer1).call())
        .to.equal(web3.utils.toWei(0, "ether"));
        expect(await PresalePool.methods.balances(buyer2).call())
        .to.equal(web3.utils.toWei(0, "ether"));

        expect(await TestToken.methods.balanceOf(buyer1).call())
        .to.equal("20");
        expect(await TestToken.methods.balanceOf(buyer2).call())
        .to.equal("80");
    });

    it('does not allow a buyer to retrieve tokens more than once', async () => {
        PresalePool = await deployContract(web3, "PresalePool", creator);
        TestToken = await deployContract(web3, "TestToken", creator);

        await web3.eth.sendTransaction({
            from: buyer1,
            to: PresalePool.options.address,
            value: web3.utils.toWei(1, "ether")
        });
        await web3.eth.sendTransaction({
            from: buyer2,
            to: PresalePool.options.address,
            value: web3.utils.toWei(4, "ether")
        });

        await PresalePool.methods.closeAllowAll(
            creator
        ).send({ from: creator });

        await PresalePool.methods.setToken(
            TestToken.options.address
        ).send({ from: creator });
        await TestToken.methods.transfer(
            PresalePool.options.address, 100
        ).send({ from: creator });        

        await web3.eth.sendTransaction({
            from: buyer1,
            to: PresalePool.options.address,
            value: web3.utils.toWei(0, "ether")
        });
        expect(await PresalePool.methods.balances(buyer1).call())
        .to.equal(web3.utils.toWei(0, "ether"));
        expect(await TestToken.methods.balanceOf(buyer1).call())
        .to.equal("20");

        await web3.eth.sendTransaction({
            from: buyer1,
            to: PresalePool.options.address,
            value: web3.utils.toWei(0, "ether")
        });
        expect(await PresalePool.methods.balances(buyer1).call())
        .to.equal(web3.utils.toWei(0, "ether"));
        expect(await TestToken.methods.balanceOf(buyer1).call())
        .to.equal("20");
    });
});

