// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Pinned published Sepolia services, verified at block 11904506. No address replaces a constructor input.
library SepoliaRelease {
    bytes32 internal constant FACTORY = 0xf57e5db3c223234457157accf602863d46c709a196fd88f9e3944f063d751c19;
    bytes32 internal constant REGISTRY = 0x65053e64fceb2b1ca90efe5afc60e8e84b531d680c41747a50ea5be951abb52e;
    bytes32 internal constant FEES = 0x331d09b94bf6052e9c62668978b63c20e86b64f04734fd483e7516f84b954aaa;
    bytes32 internal constant MANAGER = 0x09930125a49f5b95caf8052991cc14d1240dca8b43f42b899115b86867e4bce1;
    bytes32 internal constant FEED = 0x9190afba2a699a9627d64ed68c7cc60e4005a8830b33183c4413b4e1a93b9ccd;
}
