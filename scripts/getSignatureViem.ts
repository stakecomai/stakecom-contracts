import { Signer } from "ethers"
import { Address, encodePacked, keccak256, toBytes } from "viem"

type BytesType = `0x${string}`

export async function getStakeSignatureViem({
	signer,
	stakerAddress,
	comAddress,
	module,
}: {
	signer: Signer
	stakerAddress: Address
	comAddress: string
	module: string
}) {
	const packedMessage = encodePacked(["address", "string", "string"], [stakerAddress, comAddress, module])
	const signature = await signPackedMessage({ signer, packedMessage })

	return signature
}

export async function signPackedMessage({ signer, packedMessage }: { signer: Signer; packedMessage: BytesType }) {
	const hash = keccak256(encodePacked(["bytes"], [packedMessage]))
	const signature = await signer.signMessage(toBytes(hash))

	return signature
}
