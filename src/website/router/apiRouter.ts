import express from "express";
import modQueueService from "../../services/modQueueService";
import { typeDiDependencyRegistryEngine } from "discordx";
import { isModOfCommunityPerson } from "../../helpers/lemmyHelper";
import CommunityService from "../../services/communityService";
import postService from "../../services/postService";
import client, { getAuth } from "../../main";
import communityConfigService from "../../services/communityConfigService";
import {
  QueueEntryResult,
  QueueEntryStatus,
} from "../../models/modQueueEntryModel";
import UserInfoResponse from "../../models/userInfoResponse";
import modLogService from "../../services/modLogService";
import authMiddleware from "../middlewares/authMiddleware";
import communityRouter from "./communityConfigApiRouter";
import utilRouter from "./utilRouter";
import {
  CommentReportView,
  CommentView,
  Post,
  PostReportView,
  PostView,
} from "lemmy-js-client";
import { getLemmyClient } from "../../helpers/clientHelper";

let modService: modQueueService | undefined;

function getModQueueService() {
  if (!modService) {
    modService =
      typeDiDependencyRegistryEngine.getService(modQueueService) || undefined;
  }
  return modService;
}
let communityServ: CommunityService | undefined;

function getCommunityService() {
  if (!communityServ) {
    communityServ =
      typeDiDependencyRegistryEngine.getService(CommunityService) || undefined;
  }
  return communityServ;
}

let modLogServ: modLogService | undefined;

function getModLogService() {
  if (!modLogServ) {
    modLogServ =
      typeDiDependencyRegistryEngine.getService(modLogService) || undefined;
  }
  return modLogServ;
}
let postServ: postService | undefined;

function getPostService() {
  if (!postServ) {
    postServ =
      typeDiDependencyRegistryEngine.getService(postService) || undefined;
  }
  return postServ;
}

let communityConfig: communityConfigService | undefined;

function getCommunityConfigService() {
  if (!communityConfig) {
    communityConfig =
      typeDiDependencyRegistryEngine.getService(communityConfigService) ||
      undefined;
  }
  return communityConfig;
}

const refreshTimers = new Map<number, NodeJS.Timeout>();

const apiRouter = express.Router();

apiRouter.get("/test", async (req, res) => {
  res.send("Hello World!");
});

apiRouter.use(authMiddleware);

apiRouter.use("/utils", utilRouter);
apiRouter.use("/community", communityRouter);

apiRouter.get("/modqueue", async (req, res) => {
  const service = getModQueueService();
  if (!service) {
    res.status(500).send("Service not found");
    return;
  }
  const headers = req.headers;

  const user = Number(headers.user);

  const instance = headers.instance;

  const foundUser = await getCommunityService()?.getUser(
    { id: user },
    false,
    getLemmyClient(instance as string)
  );

  if (!foundUser) {
    res.status(401).send("User not found");
    return;
  }

  const entries = (await service.getModQueueEntries()).filter((entry) => {
    return (
      foundUser.person_view.person.admin ||
      foundUser.moderates.some(
        (x) => x.community.id === entry.entry.community.id
      )
    );
  });
  res.json(entries);
});
apiRouter.get("/modqueue/refresh/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) {
      res.status(400).send("No id given!");
      return;
    }

    const service = getModQueueService();
    if (!service) {
      res.status(500).send("Service not found");
      return;
    }
    const headers = req.headers;
    const user = Number(headers.user);

    const instance = headers.instance;

    const foundUser = await getCommunityService()?.getUser(
      { id: user },
      false,
      getLemmyClient(instance as string)
    );
    if (!foundUser) {
      res.status(401).send("User not found");
      return;
    }

    const entry = await service.getModQueueEntryById(id);

    if (!entry) {
      res.status(404).send("Entry not found");
      return;
    }

    if (
      !isModOfCommunityPerson(
        foundUser.person_view.person,
        entry.entry.community.id
      )
    ) {
      res.status(401).send("User is not mod");
      return;
    }

    const config = await getCommunityConfigService()?.getCommunityConfig(
      entry.entry.community
    );

    if (!config) {
      res.status(404).send("Config not found");
      return;
    }

    const result = await service.refreshModQueueEntry(entry);

    res.json(result);
  } catch (e) {
    console.log(e);
    res.status(500).send("Internal Server Error");
  }
});
apiRouter.put("/modqueue/resolve", async (req, res) => {
  const service = getModQueueService();
  if (!service) {
    res.status(500).send("Service not found");
    return;
  }
  try {
    const body = req.body;
    const reason = body.reason || "No Reason given";
    const headers = req.headers;
    const token = headers.authorization?.split(" ")[1] as string;

    const user = Number(headers.user);

    const instance = headers.instance;

    const foundUser = await getCommunityService()?.getUser({ id: user }, false, getLemmyClient(instance as string));

    if (!foundUser) {
      res.status(401).send("User not found");
      return;
    }
    const entry = await service.getModQueueEntryById(body.id);
    if (!entry) {
      res.status(404).send("Entry not found");
      return;
    }
    if (
      !isModOfCommunityPerson(
        foundUser.person_view.person,
        entry.entry.community.id
      )
    ) {
      res.status(401).send("User is not mod");
      return;
    }

    const isReport =
      "comment_report" in entry.entry || "post_report" in entry.entry;

    const isCommentReport = "comment_report" in entry.entry;

    const config = await getCommunityConfigService()?.getCommunityConfig(
      entry.entry.community
    );

    if (!config) {
      res.status(404).send("Config not found");
      return;
    }
    const wasBan = entry.result === QueueEntryResult.Banned;
    if (!body.result) {
      entry.status = QueueEntryStatus.Pending;
      entry.result = null;
    } else {
      entry.result = body.result;
      entry.status = QueueEntryStatus.Completed;
    }
    switch (entry.result) {
      case QueueEntryResult.Approved:
        if (
          !isReport &&
          (config.modQueueSettings.modQueueType === "active" ||
            (config.modQueueSettings.modQueueType === "passive" &&
              entry.entry.post.removed))
        ) {
          await client.removePost({
            auth: token,
            post_id: entry.entry.post.id,
            removed: false,
            reason: `Approved with the reason:- ${reason}`,
          });
        }

        if (wasBan) {
          await client.banFromCommunity({
            auth: token,
            community_id: entry.entry.community.id,
            person_id: entry.entry.post.creator_id,
            ban: false,
          });
        }

        if (isReport) {
          if (isCommentReport) {
            await client.resolveCommentReport({
              auth: token,
              report_id: (entry.entry as CommentReportView).comment_report.id,
              resolved: true,
            });
          } else {
            await client.resolvePostReport({
              auth: token,
              report_id: (entry.entry as PostReportView).post_report.id,
              resolved: true,
            });
          }
        }

        break;
      case QueueEntryResult.Removed:
        await client.removePost({
          auth: token,
          post_id: entry.entry.post.id,
          removed: true,
          reason: `Removed with the reason:- ${reason}`,
        });
        break;
      case QueueEntryResult.Locked:
        await client.lockPost({
          auth: token,
          post_id: entry.entry.post.id,
          locked: true,
        });
        break;
      case QueueEntryResult.Banned:
        await client.banFromCommunity({
          auth: token,
          community_id: entry.entry.community.id,
          person_id: entry.entry.creator.id,
          ban: true,
          reason: `Banned with the reason:- ${reason}`,
        });
        break;
      case null:
        if (
          !isReport &&
          (config.modQueueSettings.modQueueType === "active" ||
            (config.modQueueSettings.modQueueType === "passive" &&
              entry.entry.post.removed))
        ) {
          await client.removePost({
            auth: token,
            post_id: entry.entry.post.id,
            removed: config.modQueueSettings.modQueueType === "active",
            reason: `Reopened Mod Queue Entry with the reason:- ${reason}`,
          });
        }

        if (isReport) {
          if (wasBan) {
            await client.banFromCommunity({
              auth: token,
              community_id: entry.entry.community.id,
              person_id: entry.entry.creator.id,
              ban: false,
            });
          }

          if (isCommentReport) {
            await client.resolveCommentReport({
              auth: token,
              report_id: (entry.entry as CommentReportView).comment_report.id,
              resolved: false,
            });
          } else {
            await client.resolvePostReport({
              auth: token,
              report_id: (entry.entry as PostReportView).post_report.id,
              resolved: false,
            });
          }
        } else {
          if (wasBan) {
            await client.banFromCommunity({
              auth: token,
              community_id: entry.entry.community.id,
              person_id: entry.entry.post.creator_id,
              ban: false,
            });
          }
        }

        setTimeout(async () => {
          const result = await service.refreshModQueueEntry(entry);
        }, 5000);
        break;
      default:
        res.status(500).send("Error");
        return;
    }
    const timer = refreshTimers.get(entry.entry.post.id);
    if (timer) {
      clearTimeout(timer);
      refreshTimers.delete(entry.entry.post.id);
    }
    refreshTimers.set(
      entry.entry.post.id,
      setTimeout(async () => {
        await service.refreshModQueueEntry(entry);
      }, 5000)
    );

    entry.resultData = {
      modId: user,
      reason: reason,
    };

    entry.modNote = entry.modNote || [];

    entry.modNote.push({
      person: foundUser.person_view,
      note: `${body.result || "reopened"} - ${reason}`,
    });

    res.json(await service.updateModQueueEntry(entry));
  } catch (e) {
    console.log(e);
    res.status(500).send("Error");
  }
});

apiRouter.put("/modqueue/addnote", async (req, res) => {
  const service = getModQueueService();
  if (!service) {
    res.status(500).send("Service not found");
    return;
  }
  try {
    const body = req.body;
    const headers = req.headers;
    const token = headers.authorization?.split(" ")[1];
    if (!token) {
      res.status(401).send("No Token");
      return;
    }
    const user = Number(headers.user);
    if (!user) {
      res.status(401).send("No User");
      return;
    }

    const foundUser = await getCommunityService()?.getUser({ id: user });

    if (!foundUser) {
      res.status(401).send("User not found");
      return;
    }

    const post = await getPostService()?.getPost(body.postId);
    if (!post) {
      res.status(404).send("Post not found");
      return;
    }

    if (
      !isModOfCommunityPerson(foundUser.person_view.person, post.community.id)
    ) {
      res.status(401).send("User is not mod");
      return;
    }

    const entry = await service.getModQueueEntryByPostId(post.post.id);
    if (!entry) {
      res.status(404).send("Entry not found");
      return;
    }

    entry.modNote = entry.modNote || [];
    entry.modNote.push({ person: foundUser.person_view, note: body.modNote });

    res.json(await service.updateModQueueEntry(entry));
  } catch (e) {
    console.log(e);
    res.status(500).send("Error");
  }
});

apiRouter.post("/user/info", async (req, res) => {
  const headers = req.headers;
  const token = headers.authorization?.split(" ")[1];
  if (!token) {
    res.status(401).send("No Token");
    return;
  }
  const user = Number(headers.user);
  if (!user) {
    res.status(401).send("No User");
    return;
  }

  const foundUser = await getCommunityService()?.getUser({ id: user });

  if (!foundUser) {
    res.status(401).send("User not found");
    return;
  }
  const service = getCommunityService();
  if (!service) {
    res.status(500).send("Service not found");
    return;
  }
  const modLogService = getModLogService();
  try {
    const userId = Number(req.body.userId);
    const communityId = Number(req.body.communityId);
    const user = await service.getUser({ id: userId });
    if (!user) {
      res.status(404).send("User not found");
      return;
    }

    const modLogEntry = await modLogService?.getModLogEntriesForUser(
      token,
      user.person_view.person.id,
      communityId
    );
    if (!modLogEntry) {
      res.status(200).json({ success: false });
      return;
    }
    const response: UserInfoResponse = {
      success: true,
      modLog: modLogEntry,
      person: user,
    };

    res.json(response);
  } catch (e) {
    console.log(e);
    res.status(500).send("Error");
  }
});

apiRouter.post("/user/update", async (req, res) => {
  const body = req.body;
  const headers = req.headers;
  const token = headers.authorization?.split(" ")[1];
  if (!token) {
    res.status(401).send("No Token");
    return;
  }
  const user = Number(headers.user);
  if (!user) {
    res.status(401).send("No User");
    return;
  }

  const foundUser = await getCommunityService()?.getUser({ id: user });

  if (!foundUser) {
    res.status(401).send("User not found");
    return;
  }
  const service = getModQueueService();
  if (!service) {
    res.status(500).send("Service not found");
    return;
  }
  try {
  } catch (e) {
    console.log(e);
    res.status(500).send("Error");
  }
});
export default apiRouter;
