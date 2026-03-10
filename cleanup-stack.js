/**
 * One-time script: delete broken CloudFormation stacks whose deployment buckets were removed.
 * Run: node cleanup-stack.js
 * Delete this file after successful cleanup.
 */
const { CloudFormationClient, DeleteStackCommand, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');

const REGION = 'ap-south-1';
const STACKS = ['venue-management-api-dev', 'venue-management-api-prod'];

const cf = new CloudFormationClient({ region: REGION });

async function deleteStack(stackName) {
  console.log(`\n--- ${stackName} ---`);

  try {
    const desc = await cf.send(new DescribeStacksCommand({ StackName: stackName }));
    const status = desc.Stacks?.[0]?.StackStatus;
    console.log(`  Status: ${status}`);
  } catch (e) {
    if (e.message?.includes('does not exist')) {
      console.log('  Stack does not exist — nothing to delete.');
      return;
    }
    throw e;
  }

  console.log('  Sending delete request...');
  await cf.send(new DeleteStackCommand({ StackName: stackName }));
  console.log('  Delete initiated. Waiting for completion...');

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const desc = await cf.send(new DescribeStacksCommand({ StackName: stackName }));
      const status = desc.Stacks?.[0]?.StackStatus;
      process.stdout.write(`  ${status}...`);

      if (status === 'DELETE_COMPLETE') {
        console.log('\n  Deleted successfully!');
        return;
      }
      if (status === 'DELETE_FAILED') {
        console.log('\n  DELETE_FAILED — retrying with retain all resources...');
        const resources = desc.Stacks[0].StackStatusReason || '';
        console.log(`  Reason: ${resources}`);

        const { ListStackResourcesCommand } = require('@aws-sdk/client-cloudformation');
        const res = await cf.send(new ListStackResourcesCommand({ StackName: stackName }));
        const retainIds = (res.StackResourceSummaries || []).map(r => r.LogicalResourceId);
        console.log(`  Retaining ${retainIds.length} resources: ${retainIds.join(', ')}`);

        await cf.send(new DeleteStackCommand({ StackName: stackName, RetainResources: retainIds }));
        console.log('  Retry delete sent. Waiting...');
        continue;
      }
    } catch (e) {
      if (e.message?.includes('does not exist')) {
        console.log('\n  Deleted successfully!');
        return;
      }
    }
  }
  console.log('  Timed out waiting for delete.');
}

(async () => {
  console.log('Cleaning up broken CloudFormation stacks...');
  for (const stack of STACKS) {
    await deleteStack(stack);
  }
  console.log('\nDone! Now run: serverless deploy');
})();
