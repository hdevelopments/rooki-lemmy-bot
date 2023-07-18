import { LemmyOn } from "../decorators/lemmyPost";
import LogService from "../services/logService";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import {
  CommentReportView,
  CommentView,
  PostReportView,
  PostView,
} from "lemmy-js-client";
import { activeCommunities } from "../config";
import LogHelper from "../helpers/logHelper";
import { CommunityConfig } from "../models/iConfig";
import postViewModel from "../models/postViewModel";
import commentViewModel from "../models/commentViewModel";

const logService = LogService;

const getActionForComment = (comment: CommentView) => {
  const row = new ActionRowBuilder<ButtonBuilder>();

  const removeButton = new ButtonBuilder()
    .setCustomId(
      `remove_comment_${!comment.comment.removed}_${comment.comment.id}`
    )
    .setLabel(`${!comment.comment.removed ? "Remove" : "Recover"} Comment`)
    .setStyle(ButtonStyle.Primary);
  const banButton = new ButtonBuilder()
    .setCustomId(
      `ban_user_${!comment.creator_banned_from_community}_${
        comment.community.id
      }_${comment.creator.id}`
    )
    .setLabel(
      `${!comment.creator_banned_from_community ? "Ban" : "Unban"} User`
    )
    .setStyle(ButtonStyle.Danger);

  const refreshButton = new ButtonBuilder().setCustomId(
    `refresh_comment_${comment.comment.id}`
  ).setStyle(ButtonStyle.Secondary).setEmoji("🔄");
  row.addComponents(removeButton, banButton, refreshButton);

  return row;
};

const getActionForPost = (post: PostView) => {
  const row = new ActionRowBuilder<ButtonBuilder>();

  const removeButton = new ButtonBuilder()
    .setCustomId(`remove_post_${!post.post.removed}_${post.post.id}`)
    .setLabel(`${!post.post.removed ? "Remove" : "Restore"} Post`)
    .setStyle(ButtonStyle.Primary);

  const banButton = new ButtonBuilder()
    .setCustomId(
      `ban_user_${!post.creator_banned_from_community}_${post.community.id}_${
        post.creator.id
      }`
    )
    .setLabel(`${!post.creator_banned_from_community ? "Ban" : "Unban"} User`)
    .setStyle(ButtonStyle.Danger);

  const refreshButton = new ButtonBuilder().setCustomId(
    `refresh_post_${post.post.id}`
  ).setStyle(ButtonStyle.Secondary).setEmoji("🔄");
  row.addComponents(removeButton, banButton, refreshButton);

  return row;
};

const getActionForPostReport = (post: PostReportView) => {
  const row = new ActionRowBuilder<ButtonBuilder>();

  const resolveButton = new ButtonBuilder()
    .setCustomId(
      `resolve_postreport_${!post.post_report.resolved}_${post.post_report.id}`
    )
    .setLabel(
      `${!post.post_report.resolved ? "Resolve" : "Unresolve"} Post Report`
    )
    .setStyle(ButtonStyle.Danger);

  row.addComponents(resolveButton);

  return row;
};
const getActionForCommentReport = (comment: CommentReportView) => {
  const row = new ActionRowBuilder<ButtonBuilder>();

  const resolveButton = new ButtonBuilder()
    .setCustomId(
      `resolve_commentreport_${!comment.comment_report.resolved}_${
        comment.comment_report.id
      }`
    )
    .setLabel(
      `${
        !comment.comment_report.resolved ? "Resolve" : "Unresolve"
      } Comment Report`
    )
    .setStyle(ButtonStyle.Danger);

  row.addComponents(resolveButton);

  return row;
};

export {
  getActionForComment,
  getActionForPost,
  getActionForPostReport,
  getActionForCommentReport,
};

class LogHandler {
  @LemmyOn({ event: "postcreated" })
  async handlePost(postData: postViewModel, communityConfig: CommunityConfig) {
    if (
      !communityConfig.logs.discord.enabled ||
      !communityConfig.logs.discord.posts.enabled
    )
      return;
    logService.Log(
      {
        content: "Post created!",
        embeds: [LogHelper.postToEmbed(postData)],
        components: [getActionForPost(postData)],
      },
      {
        channel:
          communityConfig.logs.discord.posts.channel ||
          communityConfig.logs.discord.logChannel,
        guild: communityConfig.logs.discord.logGuild,
        options: communityConfig.logs.discord.posts,
      }
    );
  }
  @LemmyOn({ event: "commentcreated" })
  async handleComments(
    commentData: commentViewModel,
    communityConfig: CommunityConfig
  ) {
    if (
      !communityConfig.logs.discord.enabled ||
      !communityConfig.logs.discord.comments.enabled
    )
      return;
    logService.Log(
      {
        content: "Comment created!",
        embeds: [LogHelper.commentToEmbed(commentData)],
        components: [getActionForComment(commentData)],
      },
      {
        channel:
          communityConfig.logs.discord.comments.channel ||
          communityConfig.logs.discord.logChannel,
        guild: communityConfig.logs.discord.logGuild,
        options: communityConfig.logs.discord.comments,
      }
    );
  }
  @LemmyOn({ event: "commentreportcreated", community: activeCommunities })
  async logCommentReports(
    reportView: CommentReportView,
    communityConfig: CommunityConfig
  ) {
    if (
      !communityConfig.logs.discord.enabled ||
      !communityConfig.logs.discord.reports.enabled
    )
      return;
    await logService.Log(
      {
        content: "New Comment Report!",
        embeds: LogHelper.commentReportToEmbed(reportView),
        components: [getActionForCommentReport(reportView)],
      },
      {
        channel:
          communityConfig.logs.discord.reports.channel ||
          communityConfig.logs.discord.logChannel,
        guild: communityConfig.logs.discord.logGuild,
        options: communityConfig.logs.discord.reports,
      }
    );
  }

  @LemmyOn({ event: "postreportcreated", community: activeCommunities })
  async logPostReports(
    reportView: PostReportView,
    communityConfig: CommunityConfig
  ) {
    if (
      !communityConfig.logs.discord.enabled ||
      !communityConfig.logs.discord.reports.enabled
    )
      return;
    await logService.Log(
      {
        content: "New Post Report!",
        embeds: LogHelper.postReportToEmbed(reportView),
        components: [getActionForPostReport(reportView)],
      },
      {
        channel:
          communityConfig.logs.discord.reports.channel ||
          communityConfig.logs.discord.logChannel,
        guild: communityConfig.logs.discord.logGuild,
        options: communityConfig.logs.discord.reports,
      }
    );
  }
}
