import { expect } from "chai"
import { MaxUint256, parseEther } from "ethers"
import { deployments, ethers, getNamedAccounts } from "hardhat"
import { getComAddressSignature } from "../scripts/getSignature"

describe.only("StakeComAIV1", () => {
	const defaultValidator = "vali::stakecom"

	const setupFixture = deployments.createFixture(async () => {
		await deployments.fixture()
		const signers = await getNamedAccounts()

		const name = "Mocked wCom"
		const symbol = "wCom"
		const owner = signers.deployer

		const wComContract = await ethers.deployContract(
			"BasicERC20",
			[name, symbol, owner],
			await ethers.getSigner(signers.deployer)
		)

		const wComAddress = await wComContract.getAddress()

		const bridgeContract = await ethers.deployContract(
			"MockBridge",
			[wComAddress],
			await ethers.getSigner(signers.deployer)
		)

		const bridgeAddress = await bridgeContract.getAddress()

		const stakeContract = await ethers.deployContract(
			"StakeComAIV1",
			[wComAddress, bridgeAddress, defaultValidator],
			await ethers.getSigner(signers.deployer)
		)

		const stakeAddress = await stakeContract.getAddress()

		return {
			stakeContract: stakeContract,
			wComContract: wComContract,
			bridgeContract: bridgeContract,
			stakeAddress,
			deployer: signers.deployer,
			user1: signers.user1,
			accounts: await ethers.getSigners(),
			contractConstructor: {
				wComAddress,
				bridgeAddress,
				defaultValidator,
			},
		}
	})

	it("Should Return Valid Contract Configurations Passed In Constructor", async () => {
		const { contractConstructor, stakeContract, deployer } = await setupFixture()

		expect(await stakeContract.wComToken()).to.equal(contractConstructor.wComAddress)
		expect(await stakeContract.comBridge()).to.equal(contractConstructor.bridgeAddress)
		expect(await stakeContract.defaultValidator()).to.equal(contractConstructor.defaultValidator)
		expect(await stakeContract.owner()).to.equal(deployer)
		expect(await stakeContract.signer()).to.equal(deployer)
	})

	it("Should stake tokens", async () => {
		const { stakeContract, deployer, user1, wComContract, stakeAddress } = await setupFixture()
		const user1Signer = await ethers.getSigner(user1)
		const signer = await ethers.getSigner(deployer)
		const communeAddress = "mockSS58address"

		const signature = await getComAddressSignature({ signer, stakerAddress: user1, comAddress: communeAddress })
		const amount = parseEther("1000")

		// mint tokens for user
		await wComContract.mint(user1, parseEther("3000"))
		// approve tokens spend
		await wComContract.connect(user1Signer).approve(stakeAddress, MaxUint256)
		// user stakes tokens
		await stakeContract.connect(user1Signer).stake(amount, communeAddress, "", signature)

		let userStake = await stakeContract.stakers(user1)

		expect(await stakeContract.totalStaked()).to.equal(amount)
		expect(userStake.validator).to.equal(defaultValidator)
		expect(userStake.amount).to.equal(amount)
		expect(userStake.communeAddress).to.equal(communeAddress)

		// Stake again for the same user (and omit com Address)

		const amount2 = parseEther("1500")
		await stakeContract.connect(user1Signer).stake(amount2, "", "", "0x00")

		userStake = await stakeContract.stakers(user1)

		expect(await stakeContract.totalStaked()).to.equal(amount + amount2)
		expect(userStake.validator).to.equal(defaultValidator)
		expect(userStake.amount).to.equal(amount + amount2)
		expect(userStake.communeAddress).to.equal(communeAddress)
	})

	it("Should not allow staking with different validator", async () => {
		const { stakeContract, deployer, user1, wComContract, stakeAddress } = await setupFixture()
		const user1Signer = await ethers.getSigner(user1)
		const signer = await ethers.getSigner(deployer)
		const communeAddress = "mockSS58address"

		const signature = await getComAddressSignature({ signer, stakerAddress: user1, comAddress: communeAddress })
		const amount = parseEther("1000")

		// mint tokens for user
		await wComContract.mint(user1, parseEther("3000"))
		// approve tokens spend
		await wComContract.connect(user1Signer).approve(stakeAddress, MaxUint256)
		// user stakes tokens
		await stakeContract.connect(user1Signer).stake(amount, communeAddress, "", signature)

		// Stake again for the same user but change validator

		const amount2 = parseEther("1500")

		await expect(stakeContract.connect(user1Signer).stake(amount2, "", "vali::miner", "0x00")).to.be.revertedWith(
			"Cannot change existing validator during stake action. Change validator first."
		)
	})

	it("Should not allow staking if contract is paused", async () => {
		const { stakeContract, deployer, user1, wComContract, stakeAddress } = await setupFixture()
		const user1Signer = await ethers.getSigner(user1)
		const signer = await ethers.getSigner(deployer)
		const communeAddress = "mockSS58address"

		await stakeContract.toggleStakingPause()
		expect(await stakeContract.stakingPaused()).to.equal(true)

		const signature = await getComAddressSignature({ signer, stakerAddress: user1, comAddress: communeAddress })
		const amount = parseEther("1000")

		// mint tokens for user
		await wComContract.mint(user1, parseEther("3000"))
		// approve tokens spend
		await wComContract.connect(user1Signer).approve(stakeAddress, MaxUint256)

		await expect(
			stakeContract.connect(user1Signer).stake(amount, communeAddress, "", signature)
		).to.be.revertedWith("Staking is paused.")
	})

	it("Should respect allowCustomValidator flag while staking", async () => {
		const { stakeContract, deployer, user1, wComContract, stakeAddress } = await setupFixture()
		const user1Signer = await ethers.getSigner(user1)
		const signer = await ethers.getSigner(deployer)
		const communeAddress = "mockSS58address"

		expect(await stakeContract.allowCustomValidator()).to.equal(false)

		const signature = await getComAddressSignature({ signer, stakerAddress: user1, comAddress: communeAddress })
		const amount = parseEther("1000")

		// mint tokens for user
		await wComContract.mint(user1, parseEther("3000"))
		// approve tokens spend
		await wComContract.connect(user1Signer).approve(stakeAddress, MaxUint256)

		const amount2 = parseEther("1500")

		await expect(
			stakeContract.connect(user1Signer).stake(amount2, communeAddress, "vali::miner", signature)
		).to.be.revertedWith("Custom validators are not allowed.")

		await stakeContract.updateAllowCustomValidator(true)
		await stakeContract.connect(user1Signer).stake(amount, communeAddress, "vali::custom", signature)

		const userStake = await stakeContract.stakers(user1)

		expect(await stakeContract.totalStaked()).to.equal(amount)
		expect(userStake.validator).to.equal("vali::custom")
		expect(userStake.amount).to.equal(amount)
		expect(userStake.communeAddress).to.equal(communeAddress)
	})
})
