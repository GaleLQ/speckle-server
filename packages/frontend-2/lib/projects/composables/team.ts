import { Roles } from '@speckle/shared'
import type { Nullable, ServerRoles } from '@speckle/shared'
import { useActiveUser } from '~~/lib/auth/composables/activeUser'
import type {
  ProjectPageTeamDialogFragment,
  ProjectsPageTeamDialogManagePermissions_ProjectFragment
} from '~~/lib/common/generated/gql/graphql'
import type { ProjectCollaboratorListItem } from '~~/lib/projects/helpers/components'

export function useTeamManagePermissionsInternals(params: {
  props: {
    project: Ref<ProjectsPageTeamDialogManagePermissions_ProjectFragment>
  }
}) {
  const {
    props: { project }
  } = params

  const { isGuest: isServerGuest, activeUser } = useActiveUser()

  const isOwner = computed(() => project.value.role === Roles.Stream.Owner)

  return {
    activeUser,
    isOwner,
    isServerGuest
  }
}

export function useTeamDialogInternals(params: {
  props: {
    project: Ref<ProjectPageTeamDialogFragment>
  }
}) {
  const {
    props: { project }
  } = params

  const { isOwner, isServerGuest, activeUser } =
    useTeamManagePermissionsInternals(params)

  const collaboratorListItems = computed((): ProjectCollaboratorListItem[] => {
    const results: ProjectCollaboratorListItem[] = []

    for (const invitedUser of project.value.invitedTeam || []) {
      results.push({
        id: invitedUser.id,
        title: invitedUser.title,
        user: invitedUser.user || null,
        role: invitedUser.role,
        inviteId: invitedUser.inviteId,
        serverRole: (invitedUser.user?.role || null) as Nullable<ServerRoles>
      })
    }

    for (const collaborator of project.value.team) {
      results.push({
        id: collaborator.user.id,
        title: collaborator.user.name,
        user: collaborator.user,
        role: collaborator.role,
        inviteId: null,
        serverRole: collaborator.user.role as ServerRoles
      })
    }

    return results
  })

  const canLeaveProject = computed(() => {
    if (!activeUser.value) return false
    if (!project.value.role) return false

    const userId = activeUser.value.id
    const owners = project.value.team.filter((t) => t.role === Roles.Stream.Owner)
    return owners.length !== 1 || owners[0].user.id !== userId
  })

  return {
    collaboratorListItems,
    isOwner,
    canLeaveProject,
    isServerGuest
  }
}
