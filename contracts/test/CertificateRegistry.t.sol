// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {
    IAccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/IAccessControlDefaultAdminRules.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {CertificateRegistry} from "../src/CertificateRegistry.sol";

contract CertificateRegistryTest is Test {
    CertificateRegistry internal registry;
    address internal admin = makeAddr("admin");
    address internal issuer = makeAddr("issuer");
    address internal secondIssuer = makeAddr("secondIssuer");
    address internal outsider = makeAddr("outsider");
    bytes32 internal constant ROLE = keccak256("ISSUER_ROLE");
    bytes32 internal constant ID = bytes32(uint256(1));
    // Literal avoids a SHA-256 precompile call consuming vm.prank/expectRevert.
    bytes32 internal constant HASH = 0xc383f79d7a70a4239162abd9aae19195f792f4b2ca6704a4788cb95d1fb136cd;
    uint48 internal constant DELAY = 60;

    event CertificateIssued(
        bytes32 indexed id, address indexed issuer, bytes32 documentHash, uint64 issuedAt
    );
    event CertificateRevoked(
        bytes32 indexed id, address indexed issuer, address indexed revokedBy, uint64 revokedAt
    );
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);

    function setUp() public {
        vm.warp(1000);
        vm.roll(10);
        registry = new CertificateRegistry(admin, DELAY);
        vm.startPrank(admin);
        registry.grantRole(ROLE, issuer);
        registry.grantRole(ROLE, secondIssuer);
        vm.stopPrank();
    }

    function _issue() internal {
        vm.prank(issuer);
        registry.issueCertificate(ID, HASH);
    }

    function _batch(uint256 count) internal pure returns (bytes32[] memory ids, bytes32[] memory hashes) {
        ids = new bytes32[](count);
        hashes = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            ids[i] = bytes32(i + 1);
            hashes[i] = sha256(abi.encode(i + 1));
        }
    }

    function _unauthorized(address caller, bytes32 role) internal {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, caller, role)
        );
        vm.prank(caller);
    }

    function test_ConstructorSeparatesAdminAndIssuer() public view {
        assertEq(registry.defaultAdmin(), admin);
        assertEq(registry.owner(), admin);
        assertEq(registry.defaultAdminDelay(), DELAY);
        assertEq(registry.getRoleAdmin(ROLE), bytes32(0));
        assertFalse(registry.hasRole(ROLE, admin));
        assertFalse(registry.hasRole(bytes32(0), address(this)));
        assertEq(registry.MAX_BATCH_SIZE(), 50);
    }

    function test_ZeroAdminRejected() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControlDefaultAdminRules.AccessControlInvalidDefaultAdmin.selector, address(0)
            )
        );
        new CertificateRegistry(address(0), DELAY);
    }

    function test_AdminGrantsAndRemovesIssuerWithEvents() public {
        vm.expectEmit(true, true, true, true, address(registry));
        emit RoleGranted(ROLE, outsider, admin);
        vm.prank(admin);
        registry.grantRole(ROLE, outsider);
        assertTrue(registry.hasRole(ROLE, outsider));
        vm.expectEmit(true, true, true, true, address(registry));
        emit RoleRevoked(ROLE, outsider, admin);
        vm.prank(admin);
        registry.revokeRole(ROLE, outsider);
        assertFalse(registry.hasRole(ROLE, outsider));
    }

    function test_IssuerCannotGrantOrRemoveRoles() public {
        _unauthorized(issuer, bytes32(0));
        registry.grantRole(ROLE, outsider);
        _unauthorized(issuer, bytes32(0));
        registry.revokeRole(ROLE, secondIssuer);
        _unauthorized(outsider, bytes32(0));
        registry.grantRole(ROLE, outsider);
    }

    function test_ZeroIssuerRejected() public {
        vm.expectRevert(CertificateRegistry.ZeroIssuerAddress.selector);
        vm.prank(admin);
        registry.grantRole(ROLE, address(0));
    }

    function test_DuplicateGrantAndMissingRemovalAreIdempotent() public {
        vm.recordLogs();
        vm.startPrank(admin);
        registry.grantRole(ROLE, issuer);
        registry.revokeRole(ROLE, outsider);
        vm.stopPrank();
        assertEq(vm.getRecordedLogs().length, 0);
    }

    function test_SingleIssuanceStoresExactFieldsAndEmitsEvent() public {
        vm.expectEmit(true, true, false, true, address(registry));
        emit CertificateIssued(ID, issuer, HASH, 1000);
        _issue();
        (bool exists, CertificateRegistry.Certificate memory record) = registry.getCertificate(ID);
        assertTrue(exists);
        assertEq(record.documentHash, HASH);
        assertEq(record.issuer, issuer);
        assertEq(record.issuedAt, 1000);
        assertEq(record.issuedBlock, 10);
        assertEq(record.revokedAt, 0);
        assertFalse(record.revoked);
    }

    function test_UnauthorizedAndAdminCannotIssue() public {
        _unauthorized(outsider, ROLE);
        registry.issueCertificate(ID, HASH);
        _unauthorized(admin, ROLE);
        registry.issueCertificate(ID, HASH);
        (bytes32[] memory ids, bytes32[] memory hashes) = _batch(2);
        _unauthorized(outsider, ROLE);
        registry.issueBatch(ids, hashes);
        _unauthorized(admin, ROLE);
        registry.issueBatch(ids, hashes);
    }

    function test_AdminCanIssueOnlyAfterExplicitGrant() public {
        vm.startPrank(admin);
        registry.grantRole(ROLE, admin);
        registry.issueCertificate(ID, HASH);
        vm.stopPrank();
        (, CertificateRegistry.Certificate memory record) = registry.getCertificate(ID);
        assertEq(record.issuer, admin);
    }

    function test_ZeroIdAndDigestRejected() public {
        vm.startPrank(issuer);
        vm.expectRevert(CertificateRegistry.ZeroCertificateId.selector);
        registry.issueCertificate(bytes32(0), HASH);
        vm.expectRevert(CertificateRegistry.ZeroDocumentHash.selector);
        registry.issueCertificate(ID, bytes32(0));
        vm.stopPrank();
    }

    function test_DuplicateIdRejectedAcrossIssuers() public {
        _issue();
        bytes32 differentHash = sha256("different");
        vm.expectRevert(abi.encodeWithSelector(CertificateRegistry.CertificateAlreadyExists.selector, ID));
        vm.prank(secondIssuer);
        registry.issueCertificate(ID, differentHash);
        (, CertificateRegistry.Certificate memory record) = registry.getCertificate(ID);
        assertEq(record.issuer, issuer);
        assertEq(record.documentHash, HASH);
    }

    function test_SameDigestAllowedForDifferentIds() public {
        _issue();
        vm.prank(secondIssuer);
        registry.issueCertificate(bytes32(uint256(2)), HASH);
        (bool exists,) = registry.getCertificate(bytes32(uint256(2)));
        assertTrue(exists);
    }

    function test_UnknownAndZeroIdLookup() public view {
        (bool exists, CertificateRegistry.Certificate memory record) = registry.getCertificate(ID);
        assertFalse(exists);
        assertEq(record.issuer, address(0));
        assertEq(record.documentHash, bytes32(0));
        assertEq(
            uint256(registry.verifyCertificate(ID, HASH)),
            uint256(CertificateRegistry.VerificationStatus.Unknown)
        );
        (exists,) = registry.getCertificate(bytes32(0));
        assertFalse(exists);
    }

    function test_VerificationStatusAndRevocationPrecedence() public {
        _issue();
        assertEq(
            uint256(registry.verifyCertificate(ID, HASH)),
            uint256(CertificateRegistry.VerificationStatus.Valid)
        );
        assertEq(
            uint256(registry.verifyCertificate(ID, bytes32(0))),
            uint256(CertificateRegistry.VerificationStatus.Modified)
        );
        vm.prank(issuer);
        registry.revokeCertificate(ID);
        assertEq(
            uint256(registry.verifyCertificate(ID, HASH)),
            uint256(CertificateRegistry.VerificationStatus.Revoked)
        );
        assertEq(
            uint256(registry.verifyCertificate(ID, bytes32(0))),
            uint256(CertificateRegistry.VerificationStatus.Revoked)
        );
    }

    function test_OrdinaryRevocationPreservesIssuanceFieldsAndEmitsActor() public {
        _issue();
        vm.warp(2000);
        vm.roll(20);
        vm.expectEmit(true, true, true, true, address(registry));
        emit CertificateRevoked(ID, issuer, issuer, 2000);
        vm.prank(issuer);
        registry.revokeCertificate(ID);
        (bool exists, CertificateRegistry.Certificate memory record) = registry.getCertificate(ID);
        assertTrue(exists);
        assertTrue(record.revoked);
        assertEq(record.revokedAt, 2000);
        assertEq(record.issuedAt, 1000);
        assertEq(record.issuedBlock, 10);
        assertEq(record.issuer, issuer);
        assertEq(record.documentHash, HASH);
    }

    function test_UnknownRevocationRejected() public {
        vm.expectRevert(abi.encodeWithSelector(CertificateRegistry.CertificateNotFound.selector, ID));
        vm.prank(admin);
        registry.revokeCertificate(ID);
    }

    function test_OtherIssuerAndOutsiderCannotRevoke() public {
        _issue();
        vm.expectRevert(
            abi.encodeWithSelector(CertificateRegistry.NotCertificateAuthority.selector, ID, secondIssuer)
        );
        vm.prank(secondIssuer);
        registry.revokeCertificate(ID);
        vm.expectRevert(
            abi.encodeWithSelector(CertificateRegistry.NotCertificateAuthority.selector, ID, outsider)
        );
        vm.prank(outsider);
        registry.revokeCertificate(ID);
    }

    function test_RemovalPreservesCertificateAndBlocksAllIssuerWrites() public {
        _issue();
        vm.prank(admin);
        registry.revokeRole(ROLE, issuer);
        assertEq(
            uint256(registry.verifyCertificate(ID, HASH)),
            uint256(CertificateRegistry.VerificationStatus.Valid)
        );
        _unauthorized(issuer, ROLE);
        registry.issueCertificate(bytes32(uint256(2)), HASH);
        (bytes32[] memory ids, bytes32[] memory hashes) = _batch(1);
        _unauthorized(issuer, ROLE);
        registry.issueBatch(ids, hashes);
        vm.expectRevert(
            abi.encodeWithSelector(CertificateRegistry.NotCertificateAuthority.selector, ID, issuer)
        );
        vm.prank(issuer);
        registry.revokeCertificate(ID);
    }

    function test_AdminCannotRevokeByVirtueOfAdminRole() public {
        _issue();
        assertFalse(registry.hasRole(ROLE, admin));
        vm.expectRevert(
            abi.encodeWithSelector(CertificateRegistry.NotCertificateAuthority.selector, ID, admin)
        );
        vm.prank(admin);
        registry.revokeCertificate(ID);
        // Removing the issuer does not hand revocation authority to the admin either.
        vm.prank(admin);
        registry.revokeRole(ROLE, issuer);
        vm.expectRevert(
            abi.encodeWithSelector(CertificateRegistry.NotCertificateAuthority.selector, ID, admin)
        );
        vm.prank(admin);
        registry.revokeCertificate(ID);
        (, CertificateRegistry.Certificate memory record) = registry.getCertificate(ID);
        assertFalse(record.revoked);
        assertEq(record.revokedAt, 0);
        assertEq(
            uint256(registry.verifyCertificate(ID, HASH)),
            uint256(CertificateRegistry.VerificationStatus.Valid)
        );
    }

    function test_AdminHoldingIssuerRoleRevokesOnlyOwnCertificates() public {
        _issue();
        bytes32 adminId = bytes32(uint256(2));
        vm.startPrank(admin);
        registry.grantRole(ROLE, admin);
        registry.issueCertificate(adminId, HASH);
        vm.expectRevert(
            abi.encodeWithSelector(CertificateRegistry.NotCertificateAuthority.selector, ID, admin)
        );
        registry.revokeCertificate(ID);
        vm.expectEmit(true, true, true, true, address(registry));
        emit CertificateRevoked(adminId, admin, admin, 1000);
        registry.revokeCertificate(adminId);
        vm.stopPrank();
        (, CertificateRegistry.Certificate memory record) = registry.getCertificate(ID);
        assertFalse(record.revoked);
    }

    function testFuzz_OnlyActiveOriginalIssuerCanRevoke(address caller) public {
        vm.assume(caller != issuer);
        _issue();
        if (caller != address(0) && !registry.hasRole(ROLE, caller)) {
            vm.prank(admin);
            registry.grantRole(ROLE, caller);
        }
        vm.expectRevert(
            abi.encodeWithSelector(CertificateRegistry.NotCertificateAuthority.selector, ID, caller)
        );
        vm.prank(caller);
        registry.revokeCertificate(ID);
        vm.prank(issuer);
        registry.revokeCertificate(ID);
        (, CertificateRegistry.Certificate memory record) = registry.getCertificate(ID);
        assertTrue(record.revoked);
    }

    function test_RegrantRestoresOriginalOwnerRevocation() public {
        _issue();
        vm.startPrank(admin);
        registry.revokeRole(ROLE, issuer);
        registry.grantRole(ROLE, issuer);
        vm.stopPrank();
        vm.prank(issuer);
        registry.revokeCertificate(ID);
        (, CertificateRegistry.Certificate memory record) = registry.getCertificate(ID);
        assertTrue(record.revoked);
    }

    function test_RevocationIrreversibleAndIdCannotBeReused() public {
        _issue();
        vm.prank(issuer);
        registry.revokeCertificate(ID);
        vm.expectRevert(abi.encodeWithSelector(CertificateRegistry.CertificateAlreadyRevoked.selector, ID));
        vm.prank(issuer);
        registry.revokeCertificate(ID);
        vm.expectRevert(
            abi.encodeWithSelector(CertificateRegistry.NotCertificateAuthority.selector, ID, admin)
        );
        vm.prank(admin);
        registry.revokeCertificate(ID);
        (, CertificateRegistry.Certificate memory record) = registry.getCertificate(ID);
        assertTrue(record.revoked);
        assertEq(record.revokedAt, 1000);
        vm.expectRevert(abi.encodeWithSelector(CertificateRegistry.CertificateAlreadyExists.selector, ID));
        vm.prank(issuer);
        registry.issueCertificate(ID, HASH);
        (bytes32[] memory ids, bytes32[] memory hashes) = _batch(1);
        vm.expectRevert(abi.encodeWithSelector(CertificateRegistry.CertificateAlreadyExists.selector, ID));
        vm.prank(issuer);
        registry.issueBatch(ids, hashes);
    }

    function test_ZeroTimestampStillTracksExistenceAndRevocation() public {
        vm.warp(0);
        _issue();
        vm.prank(issuer);
        registry.revokeCertificate(ID);
        (bool exists, CertificateRegistry.Certificate memory record) = registry.getCertificate(ID);
        assertTrue(exists);
        assertTrue(record.revoked);
        assertEq(record.revokedAt, 0);
    }

    function test_IssuerRenunciationAndCallerConfirmation() public {
        _issue();
        vm.expectRevert(IAccessControl.AccessControlBadConfirmation.selector);
        vm.prank(issuer);
        registry.renounceRole(ROLE, secondIssuer);
        vm.prank(issuer);
        registry.renounceRole(ROLE, issuer);
        assertFalse(registry.hasRole(ROLE, issuer));
        assertEq(
            uint256(registry.verifyCertificate(ID, HASH)),
            uint256(CertificateRegistry.VerificationStatus.Valid)
        );
    }

    function test_AdminCannotBypassTransferUsingGrantOrRevoke() public {
        vm.startPrank(admin);
        vm.expectRevert(IAccessControlDefaultAdminRules.AccessControlEnforcedDefaultAdminRules.selector);
        registry.grantRole(bytes32(0), outsider);
        vm.expectRevert(IAccessControlDefaultAdminRules.AccessControlEnforcedDefaultAdminRules.selector);
        registry.revokeRole(bytes32(0), admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControlDefaultAdminRules.AccessControlEnforcedDefaultAdminDelay.selector, uint48(0)
            )
        );
        registry.renounceRole(bytes32(0), admin);
        vm.stopPrank();
    }

    function test_DelayedAdminTransferGivesNewAdminNoRevocationAuthority() public {
        _issue();
        vm.prank(admin);
        registry.beginDefaultAdminTransfer(outsider);
        (address pending, uint48 schedule) = registry.pendingDefaultAdmin();
        assertEq(pending, outsider);
        assertEq(schedule, 1060);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControlDefaultAdminRules.AccessControlEnforcedDefaultAdminDelay.selector, schedule
            )
        );
        vm.prank(outsider);
        registry.acceptDefaultAdminTransfer();
        vm.warp(uint256(schedule) + 1);
        vm.prank(outsider);
        registry.acceptDefaultAdminTransfer();
        assertEq(registry.defaultAdmin(), outsider);
        _unauthorized(admin, bytes32(0));
        registry.grantRole(ROLE, admin);
        vm.expectRevert(
            abi.encodeWithSelector(CertificateRegistry.NotCertificateAuthority.selector, ID, admin)
        );
        vm.prank(admin);
        registry.revokeCertificate(ID);
        vm.expectRevert(
            abi.encodeWithSelector(CertificateRegistry.NotCertificateAuthority.selector, ID, outsider)
        );
        vm.prank(outsider);
        registry.revokeCertificate(ID);
        assertFalse(registry.hasRole(ROLE, outsider));
        vm.prank(issuer);
        registry.revokeCertificate(ID);
    }

    function test_TransferCannotBeAcceptedByWrongWalletAndCanBeCancelled() public {
        _unauthorized(issuer, bytes32(0));
        registry.beginDefaultAdminTransfer(outsider);
        vm.prank(admin);
        registry.beginDefaultAdminTransfer(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControlDefaultAdminRules.AccessControlInvalidDefaultAdmin.selector, issuer
            )
        );
        vm.prank(issuer);
        registry.acceptDefaultAdminTransfer();
        vm.prank(admin);
        registry.cancelDefaultAdminTransfer();
        (address pending, uint48 schedule) = registry.pendingDefaultAdmin();
        assertEq(pending, address(0));
        assertEq(schedule, 0);
    }

    function test_AdminDelayChangesAndRollback() public {
        vm.prank(admin);
        registry.changeDefaultAdminDelay(120);
        (uint48 delay, uint48 schedule) = registry.pendingDefaultAdminDelay();
        assertEq(delay, 120);
        assertEq(registry.defaultAdminDelay(), 60);
        vm.prank(admin);
        registry.rollbackDefaultAdminDelay();
        (, schedule) = registry.pendingDefaultAdminDelay();
        assertEq(schedule, 0);
        vm.prank(admin);
        registry.changeDefaultAdminDelay(30);
        (, schedule) = registry.pendingDefaultAdminDelay();
        vm.warp(uint256(schedule) + 1);
        assertEq(registry.defaultAdminDelay(), 30);
    }

    function test_AdminRenunciationRequiresScheduledZeroTransfer() public {
        vm.prank(admin);
        registry.beginDefaultAdminTransfer(address(0));
        (, uint48 schedule) = registry.pendingDefaultAdmin();
        vm.warp(uint256(schedule) + 1);
        vm.prank(admin);
        registry.renounceRole(bytes32(0), admin);
        assertEq(registry.defaultAdmin(), address(0));
        _unauthorized(admin, bytes32(0));
        registry.grantRole(ROLE, outsider);
        // Historical issuers remain authorized; admin renunciation is not a global shutdown.
        _issue();
    }

    function test_EmptyMismatchedAndOversizedBatchesRejected() public {
        (bytes32[] memory ids, bytes32[] memory hashes) = _batch(0);
        vm.startPrank(issuer);
        vm.expectRevert(CertificateRegistry.InvalidBatchLength.selector);
        registry.issueBatch(ids, hashes);
        (ids, hashes) = _batch(2);
        vm.expectRevert(CertificateRegistry.InvalidBatchLength.selector);
        registry.issueBatch(ids, new bytes32[](1));
        (ids, hashes) = _batch(51);
        vm.expectRevert(abi.encodeWithSelector(CertificateRegistry.BatchTooLarge.selector, 51, 50));
        registry.issueBatch(ids, hashes);
        vm.stopPrank();
    }

    function test_MaximumBatchStoresEveryRecordAndEvent() public {
        (bytes32[] memory ids, bytes32[] memory hashes) = _batch(registry.MAX_BATCH_SIZE());
        vm.recordLogs();
        vm.prank(issuer);
        registry.issueBatch(ids, hashes);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, ids.length);
        for (uint256 i; i < ids.length; ++i) {
            (bool exists, CertificateRegistry.Certificate memory record) = registry.getCertificate(ids[i]);
            assertTrue(exists);
            assertEq(record.documentHash, hashes[i]);
            assertEq(record.issuer, issuer);
            assertEq(logs[i].emitter, address(registry));
            assertEq(logs[i].topics[0], keccak256("CertificateIssued(bytes32,address,bytes32,uint64)"));
            assertEq(logs[i].topics[1], ids[i]);
            assertEq(logs[i].topics[2], bytes32(uint256(uint160(issuer))));
            assertEq(logs[i].data, abi.encode(hashes[i], uint64(1000)));
        }
    }

    function test_WithinBatchDuplicateRollsBackEarlierWrites() public {
        (bytes32[] memory ids, bytes32[] memory hashes) = _batch(3);
        ids[2] = ids[0];
        vm.expectRevert(abi.encodeWithSelector(CertificateRegistry.CertificateAlreadyExists.selector, ids[0]));
        vm.prank(issuer);
        registry.issueBatch(ids, hashes);
        (bool exists,) = registry.getCertificate(ids[0]);
        assertFalse(exists);
        (exists,) = registry.getCertificate(ids[1]);
        assertFalse(exists);
    }

    function test_ExistingIdAtEndRollsBackBatchWithoutChangingExistingRecord() public {
        _issue();
        (bytes32[] memory ids, bytes32[] memory hashes) = _batch(3);
        ids[0] = bytes32(uint256(4));
        ids[2] = ID;
        vm.expectRevert(abi.encodeWithSelector(CertificateRegistry.CertificateAlreadyExists.selector, ID));
        vm.prank(secondIssuer);
        registry.issueBatch(ids, hashes);
        (bool exists,) = registry.getCertificate(ids[0]);
        assertFalse(exists);
        (exists,) = registry.getCertificate(ids[1]);
        assertFalse(exists);
        (, CertificateRegistry.Certificate memory record) = registry.getCertificate(ID);
        assertEq(record.documentHash, HASH);
        assertEq(record.issuer, issuer);
    }

    function testFuzz_InvalidBatchMemberRollsBack(uint8 position, bool zeroId) public {
        (bytes32[] memory ids, bytes32[] memory hashes) = _batch(5);
        uint256 index = bound(position, 0, 4);
        if (zeroId) ids[index] = bytes32(0);
        else hashes[index] = bytes32(0);
        vm.expectRevert(
            zeroId
                ? CertificateRegistry.ZeroCertificateId.selector
                : CertificateRegistry.ZeroDocumentHash.selector
        );
        vm.prank(issuer);
        registry.issueBatch(ids, hashes);
        for (uint256 i; i < ids.length; ++i) {
            (bool exists,) = registry.getCertificate(ids[i]);
            assertFalse(exists);
        }
    }

    function testFuzz_ExactDigestRoundTrip(bytes32 id, bytes32 digest) public {
        vm.assume(id != bytes32(0) && digest != bytes32(0));
        vm.prank(issuer);
        registry.issueCertificate(id, digest);
        (, CertificateRegistry.Certificate memory record) = registry.getCertificate(id);
        assertEq(record.documentHash, digest);
        assertEq(
            uint256(registry.verifyCertificate(id, digest)),
            uint256(CertificateRegistry.VerificationStatus.Valid)
        );
    }

    function testFuzz_BatchEquivalentToSingleIssuance(uint8 rawCount) public {
        uint256 count = bound(rawCount, 1, registry.MAX_BATCH_SIZE());
        CertificateRegistry singleRegistry = new CertificateRegistry(admin, DELAY);
        vm.prank(admin);
        singleRegistry.grantRole(ROLE, issuer);
        (bytes32[] memory ids, bytes32[] memory hashes) = _batch(count);
        vm.startPrank(issuer);
        registry.issueBatch(ids, hashes);
        for (uint256 i; i < count; ++i) {
            singleRegistry.issueCertificate(ids[i], hashes[i]);
        }
        vm.stopPrank();
        for (uint256 i; i < count; ++i) {
            (, CertificateRegistry.Certificate memory batched) = registry.getCertificate(ids[i]);
            (, CertificateRegistry.Certificate memory single) = singleRegistry.getCertificate(ids[i]);
            assertEq(abi.encode(batched), abi.encode(single));
        }
    }

    function test_Sha256KnownVectorAndLeadingZeroBytesAreNotRehashed() public {
        // Standard SHA-256 vector; Node cross-check is documented separately.
        bytes32 digest = 0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad;
        assertEq(sha256("abc"), digest);
        vm.startPrank(issuer);
        registry.issueCertificate(ID, digest);
        registry.issueCertificate(bytes32(uint256(2)), bytes32(uint256(1)));
        vm.stopPrank();
        (, CertificateRegistry.Certificate memory record) = registry.getCertificate(ID);
        assertEq(record.documentHash, digest);
        (, record) = registry.getCertificate(bytes32(uint256(2)));
        assertEq(record.documentHash, bytes32(uint256(1)));
    }

    function test_TimestampOverflowRevertsRatherThanTruncates() public {
        uint256 overflow = uint256(type(uint64).max) + 1;
        vm.warp(overflow);
        vm.expectRevert(
            abi.encodeWithSelector(SafeCast.SafeCastOverflowedUintDowncast.selector, uint8(64), overflow)
        );
        vm.prank(issuer);
        registry.issueCertificate(ID, HASH);
    }

    function test_BlockNumberOverflowRevertsRatherThanTruncates() public {
        uint256 overflow = uint256(type(uint64).max) + 1;
        vm.roll(overflow);
        vm.expectRevert(
            abi.encodeWithSelector(SafeCast.SafeCastOverflowedUintDowncast.selector, uint8(64), overflow)
        );
        vm.prank(issuer);
        registry.issueCertificate(ID, HASH);
    }

    function test_EtherRejected() public {
        vm.deal(outsider, 1 ether);
        vm.prank(outsider);
        (bool success,) = address(registry).call{value: 1 wei}("");
        assertFalse(success);
    }
}
