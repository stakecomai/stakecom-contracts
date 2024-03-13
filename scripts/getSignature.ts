import { BytesLike, Signer, getBytes, solidityPacked, solidityPackedKeccak256 } from "ethers"

export async function getStakeSignature({
	signer,
	stakerAddress,
	comAddress,
	module,
}: {
	signer: Signer
	stakerAddress: string
	comAddress: string
	module: string
}) {
	const packedMessage = solidityPacked(["address", "string", "string"], [stakerAddress, comAddress, module])
	const signature = await signPackedMessage({ signer, packedMessage })

	return signature
}

export async function signPackedMessage({ signer, packedMessage }: { signer: Signer; packedMessage: BytesLike }) {
	const hash = solidityPackedKeccak256(["bytes"], [packedMessage])
	const signature = await signer.signMessage(getBytes(hash))

	return signature
}
