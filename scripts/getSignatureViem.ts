import { Signer } from "ethers"
import { Address, encodePacked, keccak256, toBytes } from "viem"

type BytesType = `0x${string}`

export async function getComAddressSignatureViem({
	signer,
	stakerAddress,
	comAddress,
}: {
	signer: Signer
	stakerAddress: Address
	comAddress: string
}) {
	const packedMessage = encodePacked(["address", "string"], [stakerAddress, comAddress])
	const signature = await signPackedMessage({ signer, packedMessage })

	return signature
}

export async function signPackedMessage({ signer, packedMessage }: { signer: Signer; packedMessage: BytesType }) {
	const hash = keccak256(encodePacked(["bytes"], [packedMessage]))
	const signature = await signer.signMessage(toBytes(hash))

	return signature
}
