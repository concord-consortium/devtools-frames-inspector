# Remaining for Version 1
- figure out a plan for how to handle "preserve log" with the endpoints. My hunch at this point is to clear the endpoints too, unless preserve log is checked. This makes it a more global setting.
- it will be useful if we can record a "session" of messages/events between the panel and the background. Then we can setup the panel with specific settings and then replay the session. This might help reproduce issues that only show up in the real extension within the test harness environment. This has a few questions though: when does the session start recording? How is the session recording enabled? Should we also record any settings or other chrome calls made by the panel?
- fix table column resize handles they are hard to select
- update details pane in messages view, probably details should be default and first and content second
- the endpoints page should automatically update when it can. With the test harness actions this should be easier to implement and test now
- The Hierarchy Map (shown in test harness) should support a mode where the frame is collapsed into its parent node. So this way the Tab represents itself plus its Frame. And the IFrame represents itself plus its Frame. This will reduce the number of containers shown and make it easier for someone to reason about without getting bogged down in the Frame construct the browser is using underneath. It still keeps the Document concept since there can multiple of those.
- For unknown iframes (when registration is disabled) we should have some info option in the details explaining why this is unknown: "Chrome APIs tell us this is a child frame, but it doesn't tell us which iframe element this frame is connected to. Registration messages are used to make this connection."

- truncate long values in the context pane with some way to see the full value.
- unknown openers (no openedTabs mapping) don't get a Frame in FrameStore because Frame requires numeric tabId/frameId. To support them, Frame would need to work without tab/frame IDs.

- update documentation on matching up iframes with frameIds, the issue linked in the doc is nuanced. It sounds like it will not be fixed for a while, but perhaps a new issue that provides the documentId would be something better.
- improve UI to better match the rest of the dev tools styling
- update frame id syntax so it is more liqe friendly, perhaps just tX.fY
- create a website for the extension, could just be github.io
- deploy test harness page, and manual testing page to this website

# Test Harness Separation
- separate out the test harness into its own repository.
- automatic verification of the test harness: create a new extension that can be run inside of playwright. Then have a test set of webpages, that playwright can drive to generate the same events and behavior as the test-harness. This verification can be run in GitHub actions to make sure new versions of Chrome behave the same way as what we are expecting. The hierarchy actions are designed so that we know what we need to verify.

# Version 1.1
- submit to [awesome-chrome-devtools](https://github.com/ChromeDevTools/awesome-chrome-devtools) for credibility and discoverability
- import button
- find a more precise way to know when we can send the registration messages we could try sending them every 10ms as a test and also record various event times to see if we can figure out which event has to fire before the registration message goes through.
- consider a mixed tree and table hierarchy view. This would let us show more info about each iframe and document. However with the different types it isn't clear how to do this.
- consider adding an elements side panel. It isn't possible to add a context menu item to the elements pane, but extensions can add side panels. So we could add a side panel that shows the messages and/or frame information for this element. I'm not sure this will be very useful so lets wait to see if people request it.
- consider using https://github.com/antonmedv/finder instead of our custom getDomPath function. It would be 3K injected into the content script. It has no dependencies, but we need to be careful with what gets injected in peoples pages.

# Version 2
- add timing view: a sequence diagram with one row per frame, x axis can be based on time, we'll need scaling.
- add load information for each frame
- add invasive option which overrides postMessage in the calling window. This should allow the extension to capture lost messages, and look at the timing
- see what we can do about web worker messages
- add support for message channels see the [message channel plan](plans/2026-02-23-message-channel-design.md)
- add support for [web worker messages](web-worker-messages.md)

# Waiting for Browser support
- Inspecting the iframe element directly without logging it to the console first. See [inspect-iframe-element-deferred.md](inspect-iframe-element-deferred.md) for why this isn't currently supported.
