Feature: Check-in screen

  Verify the operator check-in screen for marking cars as arrived.
  Uses a small roster (4 participants) with no cars checked in.

  Background:
    Given an event with an unstarted section and no cars checked in
    And I navigate to the check-in screen

  Scenario: Initial state shows all cars waiting
    Then the check-in counter should show "0 of 4 checked in"
    And all cars should show "Waiting" status
    And the "Start This Section" button should not be visible
    And I should see "Check in at least 2 cars to start."

  Scenario: Checking in a car updates counter and status
    When I check in car #1
    Then the check-in counter should show "1 of 4 checked in"
    And car #1 should show "Arrived" status

  Scenario: Start button appears after checking in 2 cars
    When I check in car #1
    And I check in car #2
    Then the "Start This Section" button should be visible

  Scenario: Starting the section transitions to live console
    When I check in car #1
    And I check in car #2
    And I check in car #3
    And I check in car #4
    And the operator starts the section with lanes 1, 2, and 3
    Then I should see "Staging"
