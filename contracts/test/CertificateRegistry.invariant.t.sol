// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {CertificateRegistry} from "../src/CertificateRegistry.sol";

contract RegistryHandler is Test {
    CertificateRegistry public immutable registry;
    address public immutable admin;
    address[2] internal issuers;
    address internal outsider = address(0xBAD);
    bytes32 internal constant ROLE = keccak256("ISSUER_ROLE");
    uint256 public issuedCount;
    uint256 public revocationCount;
    mapping(bytes32 => CertificateRegistry.Certificate) internal expected;

    constructor(CertificateRegistry registry_, address admin_, address first, address second) {
        registry = registry_;
        admin = admin_;
        issuers = [first, second];
    }

    function _remember(bytes32 id, bytes32 digest, address owner) internal {
        expected[id] = CertificateRegistry.Certificate({
            documentHash: digest,
            issuer: owner,
            issuedAt: uint64(block.timestamp),
            issuedBlock: uint64(block.number),
            revokedAt: 0,
            revoked: false
        });
    }

    function issue(uint256 actor, bytes32 digest) public {
        address owner = issuers[actor % 2];
        if (!registry.hasRole(ROLE, owner)) return;
        if (digest == bytes32(0)) digest = bytes32(uint256(1));
        bytes32 id = bytes32(++issuedCount);
        vm.prank(owner);
        registry.issueCertificate(id, digest);
        _remember(id, digest, owner);
    }

    function batch(uint256 actor, uint8 rawCount) public {
        address owner = issuers[actor % 2];
        if (!registry.hasRole(ROLE, owner)) return;
        uint256 count = bound(rawCount, 1, 5);
        bytes32[] memory ids = new bytes32[](count);
        bytes32[] memory digests = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            ids[i] = bytes32(++issuedCount);
            digests[i] = sha256(abi.encode(ids[i]));
            _remember(ids[i], digests[i], owner);
        }
        vm.prank(owner);
        registry.issueBatch(ids, digests);
    }

    function changeIssuer(uint256 actor, bool enabled) public {
        address owner = issuers[actor % 2];
        vm.prank(admin);
        if (enabled) registry.grantRole(ROLE, owner);
        else registry.revokeRole(ROLE, owner);
    }

    function revoke(uint256 seed, bool adminAttempt) public {
        if (issuedCount == 0) return;
        bytes32 id = bytes32(seed % issuedCount + 1);
        CertificateRegistry.Certificate storage model = expected[id];
        if (adminAttempt) {
            // The admin never holds ISSUER_ROLE here, so it must not be able to revoke anything.
            vm.prank(admin);
            (bool success,) = address(registry).call(abi.encodeCall(registry.revokeCertificate, (id)));
            assertFalse(success);
            return;
        }
        if (model.revoked) return;
        address caller = model.issuer;
        if (!registry.hasRole(ROLE, caller)) return;
        vm.prank(caller);
        registry.revokeCertificate(id);
        model.revoked = true;
        model.revokedAt = uint64(block.timestamp);
        ++revocationCount;
    }

    function unauthorizedWrites(uint256 seed) public {
        bytes32 newId = bytes32(issuedCount + 1);
        vm.startPrank(outsider);
        (bool success,) =
            address(registry).call(abi.encodeCall(registry.issueCertificate, (newId, bytes32(uint256(1)))));
        assertFalse(success);
        (success,) = address(registry).call(abi.encodeCall(registry.grantRole, (ROLE, outsider)));
        assertFalse(success);
        if (issuedCount != 0) {
            bytes32 id = bytes32(seed % issuedCount + 1);
            (success,) = address(registry).call(abi.encodeCall(registry.revokeCertificate, (id)));
            assertFalse(success);
        }
        vm.stopPrank();
        (bool exists,) = registry.getCertificate(newId);
        assertFalse(exists);
    }

    function duplicate(uint256 seed) public {
        if (issuedCount == 0) return;
        bytes32 id = bytes32(seed % issuedCount + 1);
        bytes32 replacement = sha256("replacement");
        // Keep one issuer active to ensure rejection is due to identity reuse, not only missing role.
        vm.prank(admin);
        registry.grantRole(ROLE, issuers[0]);
        vm.prank(issuers[0]);
        (bool success,) = address(registry).call(abi.encodeCall(registry.issueCertificate, (id, replacement)));
        assertFalse(success);
    }

    function advanceTime(uint16 elapsed, uint8 blocks) public {
        vm.warp(block.timestamp + uint256(elapsed));
        vm.roll(block.number + uint256(blocks));
    }

    function assertModel() external view {
        for (uint256 i = 1; i <= issuedCount; ++i) {
            bytes32 id = bytes32(i);
            (bool exists, CertificateRegistry.Certificate memory actual) = registry.getCertificate(id);
            assertTrue(exists);
            assertEq(abi.encode(actual), abi.encode(expected[id]));
            CertificateRegistry.VerificationStatus status = expected[id].revoked
                ? CertificateRegistry.VerificationStatus.Revoked
                : CertificateRegistry.VerificationStatus.Valid;
            assertEq(uint256(registry.verifyCertificate(id, expected[id].documentHash)), uint256(status));
        }
        assertFalse(registry.hasRole(ROLE, outsider));
        assertEq(registry.defaultAdmin(), admin);
    }
}

contract CertificateRegistryInvariantTest is StdInvariant, Test {
    RegistryHandler internal handler;

    function setUp() public {
        address admin = makeAddr("invariant admin");
        address first = makeAddr("invariant issuer one");
        address second = makeAddr("invariant issuer two");
        CertificateRegistry registry = new CertificateRegistry(admin, 60);
        vm.startPrank(admin);
        registry.grantRole(registry.ISSUER_ROLE(), first);
        registry.grantRole(registry.ISSUER_ROLE(), second);
        vm.stopPrank();
        handler = new RegistryHandler(registry, admin, first, second);
        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = RegistryHandler.issue.selector;
        selectors[1] = RegistryHandler.batch.selector;
        selectors[2] = RegistryHandler.changeIssuer.selector;
        selectors[3] = RegistryHandler.revoke.selector;
        selectors[4] = RegistryHandler.unauthorizedWrites.selector;
        selectors[5] = RegistryHandler.duplicate.selector;
        selectors[6] = RegistryHandler.advanceTime.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_RecordsMatchIndependentModelAndRevocationNeverReverses() public view {
        handler.assertModel();
    }
}
