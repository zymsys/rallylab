# Chapter 3: Race Day — Operator Console

## 3.1 Loading Race Data

On race day, the operator loads participant data either from a roster package exported during pre-race, or by loading demo data for testing. The demo data dialog lets you configure the number of participants per section and their check-in status.

![Load Demo Data Dialog](images/operator-dlg-demo-data.png)

## 3.2 Rally Home

The operator rally home shows all sections with their participant counts, check-in progress, and status. From here you can check in participants, start racing a section, or view the live console for an active section. The track connection badge in the top-right opens the Track Manager.

![Operator Rally Home](images/operator-rally-home.png)

## 3.3 Track Connection

Click the track badge on the Rally Home or Live Console screen to open the Track Manager dialog. RallyLab supports three ways to connect to a Pico W track controller, plus a manual fallback:

- **WiFi** — Enter the Pico's IP address and click Connect WiFi. The controller communicates over HTTP, so no USB cable is needed during the race. The IP is remembered for reconnection.
- **USB** — Click Connect USB to use Web Serial (Chrome/Edge only). While connected via USB, you can also configure the Pico's WiFi from the Track Manager — scan for networks, enter a password, and switch to wireless.
- **Fake Track** — Open the fake track simulator (`debug.html`) in another tab. It connects automatically via BroadcastChannel for testing without hardware.
- **Manual** — No track controller. The operator clicks "Run Heat" and "Next Heat" buttons to advance through the race, and uses Manual Rank to enter results by hand.

When a track is connected (WiFi, USB, or Fake), gate release and finish times are detected automatically. The connection status is shown as a badge on both the Rally Home and Live Console screens.

## 3.4 Check-In

The check-in screen shows all participants in a section with checkboxes to mark their arrival. Once at least 2 participants are checked in, the "Start This Section" button becomes available.

![Check-In Screen](images/operator-check-in.png)

## 3.5 Starting a Section

The Start Section dialog lets you choose which lanes to use. Uncheck any lanes that are unavailable (e.g., broken sensor). The schedule is automatically generated based on available lanes and checked-in participants.

![Start Section Dialog](images/operator-dlg-start-section.png)

## 3.6 Live Console — Staging

During staging, the live console shows the current heat assignment with lane numbers, car numbers, and participant names. With a connected track, the system automatically detects the start gate release. In manual mode, click "Run Heat" to advance.

![Live Console — Staging](images/operator-live-console-staging.png)

## 3.7 Live Console — Results

After a heat completes, the results panel shows finish times for each lane. The standings panel on the right updates with cumulative average times. Click "Next Heat" to advance to the next heat, or "Re-Run" if there was an issue.

![Live Console — Results](images/operator-live-console-results.png)

## 3.8 Manual Rank

If the timing system fails for a heat, use Manual Rank to enter finish positions by hand. Assign a place (1st, 2nd, etc.) or DNF to each lane.

![Manual Rank Dialog](images/operator-dlg-manual-rank.png)

## 3.9 Remove Car

Remove a car from the remaining heats if it is destroyed, disqualified, or withdrawn. Completed heat results are preserved. The schedule is regenerated for remaining heats.

![Remove Car Dialog](images/operator-dlg-remove-car.png)

## 3.10 Change Lanes

Change which lanes are active mid-race (e.g., if a lane sensor breaks). The schedule is regenerated for remaining heats using the new lane configuration.

![Change Lanes Dialog](images/operator-dlg-change-lanes.png)

## 3.11 Section Complete / Final Results

When all heats are finished, the section complete screen shows final standings with rank, average time, best time, and heat count. Results can be exported to CSV or sent to the audience display for a dramatic progressive reveal.

![Section Complete](images/operator-section-complete.png)
