"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Project,
  ProjectsFieldValue,
  generateProjectId,
  parseProjectsValue,
  stringifyProjectsValue,
} from "./index";
import type { FormFieldDefinition } from "@/types/form-config";

interface ProjectsFormRendererProps {
  field: FormFieldDefinition;
  value: unknown;
  onChange: (value: string) => void;
  disabled?: boolean;
  onFocus?: () => void;
}

export function ProjectsFormRenderer({
  field,
  value,
  onChange,
  disabled,
  onFocus,
}: ProjectsFormRendererProps) {
  const [projects, setProjects] = useState<Project[]>(() => parseProjectsValue(value));
  const [newProjectName, setNewProjectName] = useState("");

  // Sync external value changes
  useEffect(() => {
    const parsed = parseProjectsValue(value);
    // Only update if different (by comparing stringified)
    if (JSON.stringify(parsed) !== JSON.stringify(projects)) {
      setProjects(parsed);
    }
  }, [value]);

  const handleAddProject = () => {
    if (!newProjectName.trim()) return;

    const newProject: Project = {
      id: generateProjectId(),
      name: newProjectName.trim(),
    };

    const updated = [...projects, newProject];
    setProjects(updated);
    onChange(stringifyProjectsValue(updated));
    setNewProjectName("");
  };

  const handleRemoveProject = (id: string) => {
    // Don't allow removing the last project if field is required
    if (field.required && projects.length <= 1) return;

    const updated = projects.filter((p) => p.id !== id);
    setProjects(updated);
    onChange(stringifyProjectsValue(updated));
  };

  const handleProjectNameChange = (id: string, name: string) => {
    const updated = projects.map((p) => (p.id === id ? { ...p, name } : p));
    setProjects(updated);
    onChange(stringifyProjectsValue(updated));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddProject();
    }
  };

  return (
    <div className="space-y-3" onFocus={onFocus}>
      {/* Existing projects */}
      {projects.length > 0 && (
        <div className="space-y-2">
          {projects.map((project, index) => (
            <div
              key={project.id}
              className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border border-border"
            >
              <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                <FolderOpen className="h-4 w-4 text-primary" />
              </div>
              <Input
                value={project.name}
                onChange={(e) => handleProjectNameChange(project.id, e.target.value)}
                disabled={disabled}
                placeholder={`Project ${index + 1} name`}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => handleRemoveProject(project.id)}
                disabled={disabled || (field.required && projects.length <= 1)}
                className={cn(
                  "h-8 w-8 text-muted-foreground hover:text-destructive",
                  field.required && projects.length <= 1 && "opacity-30 cursor-not-allowed"
                )}
                title={
                  field.required && projects.length <= 1
                    ? "At least one project is required"
                    : "Remove project"
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add new project */}
      <div className="flex items-center gap-2">
        <Input
          value={newProjectName}
          onChange={(e) => setNewProjectName(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Enter project name..."
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddProject}
          disabled={disabled || !newProjectName.trim()}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Project
        </Button>
      </div>

      {/* Helper text */}
      {projects.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Add at least one project. Each sample will be assigned to one of these projects.
        </p>
      )}
      {projects.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {projects.length} project{projects.length !== 1 ? "s" : ""} defined.
          {projects.length === 1
            ? " All samples will be automatically assigned to this project."
            : " You can assign each sample to a project in the samples table."}
        </p>
      )}
    </div>
  );
}
