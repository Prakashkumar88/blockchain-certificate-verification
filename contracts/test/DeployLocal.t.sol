// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {CertificateRegistry} from "../src/CertificateRegistry.sol";
import {DeployLocal} from "../script/DeployLocal.s.sol";

// Inject configuration directly to avoid process-global vm.setEnv races between parallel tests.
// The real run() environment-loading path is exercised by the isolated Anvil integration harness.
contract DeployLocalHarness is DeployLocal {
    function deployForTest(address admin, uint256 delaySeconds) external returns (CertificateRegistry) {
        return _deploy(admin, delaySeconds);
    }
}

contract DeployLocalTest is Test {
    DeployLocalHarness internal deployer;
    address internal admin = makeAddr("script admin");

    function setUp() public {
        deployer = new DeployLocalHarness();
    }

    function test_DeployOnLocalChainWithExplicitAdminAndNoIssuer() public {
        vm.chainId(31337);
        CertificateRegistry registry = deployer.deployForTest(admin, 60);
        assertEq(registry.defaultAdmin(), admin);
        assertEq(registry.defaultAdminDelay(), 60);
        assertFalse(registry.hasRole(registry.ISSUER_ROLE(), admin));
    }

    function test_RejectSepolia() public {
        vm.chainId(11155111);
        vm.expectRevert(abi.encodeWithSelector(DeployLocal.LocalChainOnly.selector, 11155111));
        deployer.run();
    }

    function testFuzz_RejectEveryNonlocalChain(uint64 chainId) public {
        vm.assume(chainId != 31337);
        vm.chainId(chainId);
        vm.expectRevert(abi.encodeWithSelector(DeployLocal.LocalChainOnly.selector, uint256(chainId)));
        deployer.run();
    }

    function test_RejectOverflowingDelay() public {
        vm.chainId(31337);
        uint256 overflow = uint256(type(uint48).max) + 1;
        vm.expectRevert(
            abi.encodeWithSelector(SafeCast.SafeCastOverflowedUintDowncast.selector, uint8(48), overflow)
        );
        deployer.deployForTest(admin, overflow);
    }
}
