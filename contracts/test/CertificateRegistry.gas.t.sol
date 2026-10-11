// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {CertificateRegistry} from "../src/CertificateRegistry.sol";

/// @dev Isolated-frame gas snapshots are separate from whole-test gas in .gas-snapshot.
/// Actual local transaction receipts are independently measured by scripts/local-smoke.mjs.
contract CertificateRegistryGasTest is Test {
    CertificateRegistry internal registry;
    address internal issuer = makeAddr("gas issuer");

    function setUp() public {
        vm.warp(1000);
        vm.roll(10);
        registry = new CertificateRegistry(address(this), 60);
        registry.grantRole(registry.ISSUER_ROLE(), issuer);
    }

    function test_GasSingle() public {
        bytes32 id = sha256("gas single");
        bytes32 digest = sha256("gas digest");
        vm.prank(issuer);
        registry.issueCertificate(id, digest);
        vm.snapshotGasLastFrame("issuance", "single");
    }

    function _measureBatch(uint256 count) internal {
        bytes32[] memory ids = new bytes32[](count);
        bytes32[] memory hashes = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            ids[i] = sha256(abi.encode("gas id", i));
            hashes[i] = sha256(abi.encode("gas digest", i));
        }
        vm.prank(issuer);
        registry.issueBatch(ids, hashes);
        vm.snapshotGasLastFrame("issuance", string.concat("batch-", vm.toString(count)));
    }

    function test_GasBatch1() public {
        _measureBatch(1);
    }

    function test_GasBatch10() public {
        _measureBatch(10);
    }

    function test_GasBatch25() public {
        _measureBatch(25);
    }

    function test_GasBatch50() public {
        _measureBatch(50);
    }
}
