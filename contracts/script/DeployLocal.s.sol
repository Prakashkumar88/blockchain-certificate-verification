// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {CertificateRegistry} from "../src/CertificateRegistry.sol";

/// @notice Local chain only. No embedded private key, mnemonic or automatic issuer grants.
contract DeployLocal is Script {
    error LocalChainOnly(uint256 actualChainId);

    function run() external returns (CertificateRegistry registry) {
        _requireLocalChain();
        address admin = vm.envAddress("INITIAL_ADMIN_ADDRESS");
        return _deploy(admin, vm.envOr("ADMIN_TRANSFER_DELAY_SECONDS", uint256(60)));
    }

    function _deploy(address admin, uint256 delaySeconds) internal returns (CertificateRegistry registry) {
        _requireLocalChain();
        uint48 delay = SafeCast.toUint48(delaySeconds);
        vm.startBroadcast();
        registry = new CertificateRegistry(admin, delay);
        vm.stopBroadcast();
    }

    function _requireLocalChain() internal view {
        if (block.chainid != 31337) revert LocalChainOnly(block.chainid);
    }
}
