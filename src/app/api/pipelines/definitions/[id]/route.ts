import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import fs from 'fs';
import path from 'path';

// GET - Get pipeline definition with workflow DAG
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Load pipeline definition from JSON file
    const definitionPath = path.join(
      process.cwd(),
      'data',
      'pipeline-definitions',
      `${id}.json`
    );

    if (!fs.existsSync(definitionPath)) {
      return NextResponse.json(
        { error: 'Pipeline definition not found' },
        { status: 404 }
      );
    }

    const definitionJson = fs.readFileSync(definitionPath, 'utf-8');
    const definition = JSON.parse(definitionJson);

    // Convert steps to DAG nodes
    const nodes = definition.steps.map((step: {
      id: string;
      name: string;
      description?: string;
      category?: string;
      tools?: string[];
      outputs?: string[];
      docs?: string;
    }, idx: number) => ({
      id: step.id,
      name: step.name,
      description: step.description,
      category: step.category,
      order: idx,
      nodeType: 'step' as const,
      tools: step.tools,
      outputs: step.outputs,
      docs: step.docs,
    }));

    // Add input nodes
    if (definition.inputs) {
      definition.inputs.forEach((input: {
        id: string;
        name: string;
        description?: string;
        fileTypes?: string[];
      }, idx: number) => {
        nodes.unshift({
          id: input.id,
          name: input.name,
          description: input.description,
          category: 'input',
          order: -10 + idx,
          nodeType: 'input' as const,
          fileTypes: input.fileTypes,
        });
      });
    }

    // Add output nodes
    if (definition.outputs) {
      const maxOrder = Math.max(...nodes.map((n: { order: number }) => n.order));
      definition.outputs.forEach((output: {
        id: string;
        name: string;
        description?: string;
        fileTypes?: string[];
        fromStep?: string;
      }, idx: number) => {
        nodes.push({
          id: `output_${output.id}`,
          name: output.name,
          description: output.description,
          category: 'output',
          order: maxOrder + 10 + idx,
          nodeType: 'output' as const,
          fileTypes: output.fileTypes,
          fromStep: output.fromStep,
        });
      });
    }

    // Convert step dependencies to edges
    const edges: { from: string; to: string; label?: string }[] = [];

    // Step-to-step edges from dependsOn
    for (const step of definition.steps) {
      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          edges.push({ from: dep, to: step.id });
        }
      }
    }

    // Input-to-step edges (inputs feed into first steps)
    if (definition.inputs) {
      const firstSteps = definition.steps.filter(
        (s: { dependsOn?: string[] }) => !s.dependsOn || s.dependsOn.length === 0
      );
      for (const input of definition.inputs) {
        for (const step of firstSteps) {
          edges.push({ from: input.id, to: step.id });
        }
      }
    }

    // Step-to-output edges
    if (definition.outputs) {
      for (const output of definition.outputs) {
        if (output.fromStep) {
          edges.push({ from: output.fromStep, to: `output_${output.id}` });
        }
      }
    }

    return NextResponse.json({
      definition: {
        id: definition.pipeline,
        name: definition.name,
        description: definition.description,
        version: definition.version,
        url: definition.url,
      },
      nodes,
      edges,
    });
  } catch (error) {
    console.error('[Pipeline Definition API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load pipeline definition' },
      { status: 500 }
    );
  }
}
