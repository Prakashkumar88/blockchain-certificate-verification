// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @notice Immutable certificate commitments with irreversible revocation.
/// @dev IDs must be random/non-personal. documentHash is the exact 32-byte SHA-256
/// digest of the final PDF, ABI encoded directly as bytes32 (not hashed hex text).
/// This contract cannot determine whether a supplied digest came from a PDF.
contract CertificateRegistry is AccessControlDefaultAdminRules {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");

    /// @notice Candidate cap, validated for local development by the gas suite.
    /// @dev Reassess against the target network before any public deployment.
    uint256 public constant MAX_BATCH_SIZE = 50;

    struct Certificate {
        bytes32 documentHash;
        address issuer;
        uint64 issuedAt;
        uint64 issuedBlock;
        uint64 revokedAt;
        bool revoked;
    }

    /// @dev These are mined-state results, not confirmation or RPC availability results.
    enum VerificationStatus {
        Unknown,
        Valid,
        Modified,
        Revoked
    }

    mapping(bytes32 certificateId => Certificate) private _certificates;

    error ZeroCertificateId();
    error ZeroDocumentHash();
    error ZeroIssuerAddress();
    error CertificateAlreadyExists(bytes32 certificateId);
    error CertificateNotFound(bytes32 certificateId);
    error CertificateAlreadyRevoked(bytes32 certificateId);
    error NotCertificateAuthority(bytes32 certificateId, address caller);
    error InvalidBatchLength();
    error BatchTooLarge(uint256 supplied, uint256 maximum);

    event CertificateIssued(
        bytes32 indexed certificateId, address indexed issuer, bytes32 documentHash, uint64 issuedAt
    );
    event CertificateRevoked(
        bytes32 indexed certificateId, address indexed issuer, address indexed revokedBy, uint64 revokedAt
    );

    /// @dev The inherited constructor rejects address(0). No issuer is granted implicitly.
    constructor(address initialAdmin, uint48 adminTransferDelay)
        AccessControlDefaultAdminRules(adminTransferDelay, initialAdmin)
    {}

    /// @notice Use the inherited admin rules, adding only a zero-issuer guard.
    function grantRole(bytes32 role, address account) public override onlyRole(getRoleAdmin(role)) {
        if (role == ISSUER_ROLE && account == address(0)) revert ZeroIssuerAddress();
        super.grantRole(role, account);
    }

    function issueCertificate(bytes32 id, bytes32 documentHash) external onlyRole(ISSUER_ROLE) {
        _issue(id, documentHash);
    }

    /// @notice All records and events revert if any member is invalid or already exists.
    function issueBatch(bytes32[] calldata ids, bytes32[] calldata documentHashes)
        external
        onlyRole(ISSUER_ROLE)
    {
        uint256 count = ids.length;
        if (count == 0 || count != documentHashes.length) revert InvalidBatchLength();
        if (count > MAX_BATCH_SIZE) revert BatchTooLarge(count, MAX_BATCH_SIZE);
        for (uint256 i; i < count; ++i) {
            _issue(ids[i], documentHashes[i]);
        }
    }

    /// @notice Only the active original issuer may revoke; the default admin has no revocation power
    /// by virtue of that role. Nobody can restore a record.
    function revokeCertificate(bytes32 id) external {
        Certificate storage certificate = _certificates[id];
        if (certificate.issuer == address(0)) revert CertificateNotFound(id);
        if (!hasRole(ISSUER_ROLE, msg.sender) || certificate.issuer != msg.sender) {
            revert NotCertificateAuthority(id, msg.sender);
        }
        if (certificate.revoked) revert CertificateAlreadyRevoked(id);

        certificate.revoked = true;
        certificate.revokedAt = SafeCast.toUint64(block.timestamp);
        emit CertificateRevoked(id, certificate.issuer, msg.sender, certificate.revokedAt);
    }

    /// @notice Public ID lookup. A zero/unused ID is absent, not a call failure.
    /// @dev Revoking an issuer role does not change any historical certificate.
    function getCertificate(bytes32 id) external view returns (bool exists, Certificate memory record) {
        record = _certificates[id];
        exists = record.issuer != address(0);
    }

    /// @notice Compare a supplied digest with mined state; revocation takes precedence over mismatch.
    /// @dev No PDF or student data is supplied. Even a zero candidate digest is simply a mismatch
    /// for an existing unrevoked record. RPC errors/confirmation policy belong to the caller.
    function verifyCertificate(bytes32 id, bytes32 candidateDigest)
        external
        view
        returns (VerificationStatus)
    {
        Certificate storage certificate = _certificates[id];
        if (certificate.issuer == address(0)) return VerificationStatus.Unknown;
        if (certificate.revoked) return VerificationStatus.Revoked;
        if (certificate.documentHash != candidateDigest) return VerificationStatus.Modified;
        return VerificationStatus.Valid;
    }

    function _issue(bytes32 id, bytes32 documentHash) private {
        if (id == bytes32(0)) revert ZeroCertificateId();
        if (documentHash == bytes32(0)) revert ZeroDocumentHash();
        if (_certificates[id].issuer != address(0)) revert CertificateAlreadyExists(id);

        uint64 issuedAt = SafeCast.toUint64(block.timestamp);
        _certificates[id] = Certificate({
            documentHash: documentHash,
            issuer: msg.sender,
            issuedAt: issuedAt,
            issuedBlock: SafeCast.toUint64(block.number),
            revokedAt: 0,
            revoked: false
        });
        emit CertificateIssued(id, msg.sender, documentHash, issuedAt);
    }
}
