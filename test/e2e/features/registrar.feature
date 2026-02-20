Feature: Registrar role

  Verify the pre-race UI for registrar (non-organizer) users.
  Uses demo data which creates registrars with scoped access.

  Background:
    Given demo data has been loaded

  Scenario: Registrar auto-navigates to event home
    When I sign in with email "sarah@example.com"
    Then I should see the heading "Kub Kars Rally 2026"
    And I should not see "Your Events"

  Scenario: Registrar sees combo table without create buttons
    When I sign in with email "sarah@example.com"
    Then I should see "1st Newmarket"
    And I should see "Kub Kars"
    And I should see "Manage"
    And I should not see the button "+ Create Event"
    And I should not see the button "+ Add Section"

  Scenario: Registrar sees Check-In button not Race Day
    When I sign in with email "sarah@example.com"
    Then I should see "Race Day Check-In"
    And I should not see the button "Race Day"

  Scenario: Registrar sees filtered roster for their group
    When I sign in with email "sarah@example.com"
    And I click "Manage" for "Kub Kars"
    Then I should see "Group: 1st Newmarket"
    And I should see "Billy Thompson" in the roster
    And I should see "Sarah Chen" in the roster
    And I should see "Tommy Rodriguez" in the roster
    And I should see "Emma Wilson" in the roster

  Scenario: Registrar can add a participant
    When I sign in with email "sarah@example.com"
    And I click "Manage" for "Kub Kars"
    And I add a participant named "Zara McPherson"
    Then I should see "Zara McPherson" in the roster
    And I should see "5 participants"

  Scenario: Multi-group registrar sees all their groups
    When I sign in with email "darryl@example.com"
    Then I should see "2nd Aurora"
    And I should see "3rd Aurora"
    And I should see "Kub Kars"
    And I should see "Scout Trucks"
