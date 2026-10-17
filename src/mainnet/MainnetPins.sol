// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Ethereum runtime evidence at block 26203203. Never Sepolia pins.
library MainnetPins {
    address internal constant FACTORY_ADDRESS = address(uint160(0x12C63b581d07093F6126bc02263c58f7EadaA96F));
    bytes32 internal constant FACTORY = 0xb6a524d4b697c41f80c369f4990ac070c9dda6f3ef5efe36f21e6150a530b413;
    address internal constant MANAGER_ADDRESS = address(uint160(0x000000000004444c5dc75cB358380D2e3dE08A90));
    bytes32 internal constant MANAGER = 0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    address internal constant ROUTER_ADDRESS = address(uint160(0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af));
    bytes32 internal constant ROUTER = 0x6a5f46971b50c6e1b7eef97902311444e479d734e4f80ad88367783cf373fe7f;
    address internal constant QUOTER_ADDRESS = address(uint160(0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203));
    bytes32 internal constant QUOTER = 0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441;
    address internal constant PERMIT2_ADDRESS = address(uint160(0x000000000022D473030F116dDEE9F6B43aC78BA3));
    bytes32 internal constant PERMIT2 = 0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131;
    address internal constant IMD_ADDRESS = address(uint160(0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7));
    bytes32 internal constant IMD = 0x79a1ae149d27d4aae006d4dd75cb834222c9623799bbf34359428aaf66fec3bf;
    address internal constant ETHUSD_ADDRESS = address(uint160(0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419));
    bytes32 internal constant ETHUSD = 0x4b79b5c8aee6da0f7b393e8b53e6265ef7320a1d16184c65bd3841b5aa3d700d;
    address internal constant FEES_ADDRESS = address(uint160(0x12c9E1007262AfAC205567457F5826a9416a3863));
    bytes32 internal constant FEES = 0x331d09b94bf6052e9c62668978b63c20e86b64f04734fd483e7516f84b954aaa;
    address internal constant REGISTRY_ADDRESS = address(uint160(0xA47FcB220DDd1cDddA865F89029BEc1b9EcA3bf1));
    bytes32 internal constant REGISTRY = 0x49e6a11ab5df44d8d9ed1c62a93e6068ca209a29fac1eb89e70233101608e6fd;
}
